"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";

export type MapSite = {
  id: string;
  place: string;
  risk: number;
  status: string;
  lat: number;
  lon: number;
  rainfall?: number;
  weatherStatus?: string;
  blockage?: number;
  litter?: number;
  environmentalRisk?: number;
  environmentalLevel?: string;
  environmentalContext?: string;
  environmentalDistanceMeters?: number | null;
  recommendedAction?: string;
  photo?: string;
  isDemo?: boolean;
};

type LeafletModule = typeof import("leaflet");

function markerColor(site: MapSite) {
  if (site.status === "Verified clear") return "#dfff68";
  const concern = site.environmentalRisk ?? site.risk;
  if (concern >= 80) return "#ff745f";
  if (concern >= 60) return "#f5bd4e";
  if (concern >= 40) return "#89c9c0";
  return "#dfff68";
}

function markerSymbol(site: MapSite) {
  if (site.status === "Verified clear") return "✓";
  if (site.status === "Needs review") return "!";
  if ((site.environmentalRisk ?? site.risk) >= 60) return "▲";
  return "●";
}

export function DrainMap({
  sites,
  selectedId,
  onSelect,
}: {
  sites: MapSite[];
  selectedId: string;
  onSelect: (site: MapSite) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerLayerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const [ready, setReady] = useState(false);
  const initialSiteRef = useRef(sites.find((site) => site.id === selectedId) ?? sites[0]);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;
      const selected = initialSiteRef.current;
      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView([selected.lat, selected.lon], 13);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      markerLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    }

    void initialize();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerLayerRef.current = null;
      leafletRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!L || !map || !markerLayer) return;

    markerLayer.clearLayers();
    for (const site of sites) {
      const selected = site.id === selectedId;
      const marker = L.circleMarker([site.lat, site.lon], {
        radius: selected ? 14 : 11,
        color: selected ? "#0b1713" : "#ffffff",
        weight: selected ? 4 : 3,
        fillColor: markerColor(site),
        fillOpacity: 1,
      });
      const environmentalRisk = site.environmentalRisk ?? site.risk;
      marker.bindTooltip(`${markerSymbol(site)} ${environmentalRisk}`, {
        permanent: true,
        direction: "center",
        className: "garbage-risk-tooltip",
      });
      const popup = document.createElement("div");
      const identifier = document.createElement("strong");
      identifier.textContent = site.id;
      popup.append(identifier, document.createElement("br"));
      if (site.photo) {
        const photo = document.createElement("img");
        photo.src = site.photo;
        photo.alt = `Inspection evidence for ${site.id}`;
        photo.width = 220;
        photo.height = 120;
        photo.className = "map-popup-photo";
        popup.append(photo);
      }
      popup.append(document.createTextNode(site.place), document.createElement("br"));
      popup.append(document.createTextNode(`Coordinates ${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}`), document.createElement("br"));
      popup.append(document.createTextNode(`Cleanup priority ${site.risk}/100`), document.createElement("br"));
      popup.append(document.createTextNode(`Environmental concern ${environmentalRisk}/100`), document.createElement("br"));
      popup.append(document.createTextNode(`Blockage ${site.blockage ?? "—"}/100 · litter ${site.litter ?? "—"}/100`), document.createElement("br"));
      popup.append(document.createTextNode(`Rainfall ${site.rainfall?.toFixed(1) ?? "—"} mm`), document.createElement("br"));
      popup.append(document.createTextNode(site.environmentalContext ?? "Environmental context unavailable"), document.createElement("br"));
      popup.append(document.createTextNode(`Status: ${site.status}`), document.createElement("br"));
      popup.append(document.createTextNode(site.recommendedAction ?? "Open the report for the recommended action."));
      marker.bindPopup(popup);
      marker.on("click", () => onSelectRef.current(site));
      marker.addTo(markerLayer);
      marker.getElement()?.setAttribute("aria-label", `${site.id}, ${site.place}, environmental concern ${environmentalRisk} out of 100, ${site.status}`);
    }

    const selected = sites.find((site) => site.id === selectedId);
    if (selected) map.flyTo([selected.lat, selected.lon], Math.max(map.getZoom(), 14), { duration: 0.75 });
  }, [ready, selectedId, sites]);

  return (
    <div className="map-live-wrap">
      <div ref={containerRef} className="real-map" aria-label="OpenStreetMap showing reported garbage locations" />
      <div className="map-key">
        <span><i className="key-critical" /> ▲ High concern</span>
        <span><i className="key-watch" /> ● Moderate</span>
        <span><i className="key-low" /> ✓ Verified</span>
        <span><i className="key-review" /> ! Review</span>
      </div>
    </div>
  );
}
