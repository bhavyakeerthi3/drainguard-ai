import { SCORING_CONFIG } from "./scoring/config.ts";
import type { WaterwayContext } from "./scoring/environmentalRisk.ts";

type OverpassElement = {
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: { name?: string; waterway?: string; natural?: string };
};

function distanceMeters(fromLat: number, fromLon: number, toLat: number, toLon: number) {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(toLat - fromLat);
  const longitudeDelta = toRadians(toLon - fromLon);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchWaterwayContext(latitude: number, longitude: number, signal?: AbortSignal): Promise<WaterwayContext> {
  const radius = SCORING_CONFIG.waterway.searchRadiusMeters;
  const query = `[out:json][timeout:8];(node["waterway"~"river|stream|canal"](around:${radius},${latitude},${longitude});way["waterway"~"river|stream|canal"](around:${radius},${latitude},${longitude});way["natural"="water"](around:${radius},${latitude},${longitude});relation["natural"="water"](around:${radius},${latitude},${longitude}););out center tags;`;
  const timeoutController = new AbortController();
  const timeout = window.setTimeout(() => timeoutController.abort(), 9000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ data: query }),
      signal: combinedSignal,
    });
    if (!response.ok) throw new Error(`Waterway service returned ${response.status}`);
    const data = await response.json() as { elements?: OverpassElement[] };
    const candidates = (data.elements ?? []).flatMap((element) => {
      const lat = element.lat ?? element.center?.lat;
      const lon = element.lon ?? element.center?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      return [{
        distanceMeters: distanceMeters(latitude, longitude, lat as number, lon as number),
        featureName: element.tags?.name,
        featureType: element.tags?.waterway ?? (element.tags?.natural === "water" ? "water body" : "mapped water feature"),
      }];
    });
    const nearest = candidates.reduce<(typeof candidates)[number] | null>((best, candidate) => (
      !best || candidate.distanceMeters < best.distanceMeters ? candidate : best
    ), null);

    if (!nearest) {
      return {
        status: "available",
        distanceMeters: radius,
        source: "OpenStreetMap / Overpass",
        message: `No mapped water feature found within ${radius / 1000} km; proximity concern is low.`,
      };
    }

    return {
      status: "available",
      distanceMeters: Math.round(nearest.distanceMeters),
      featureName: nearest.featureName,
      featureType: nearest.featureType,
      source: "OpenStreetMap / Overpass",
      message: `${nearest.featureName ?? "Mapped water feature"} is approximately ${Math.round(nearest.distanceMeters)} m away.`,
    };
  } catch {
    return {
      status: "unavailable",
      distanceMeters: null,
      source: "OpenStreetMap / Overpass",
      message: "Environmental context unavailable. The remaining analysis is still usable with lower evidence coverage.",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
