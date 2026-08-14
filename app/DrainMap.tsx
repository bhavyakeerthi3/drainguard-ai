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
};

type LeafletModule = typeof import("leaflet");

function markerColor(site: MapSite) {
  if (site.status === "Verified clear") return "#dfff68";
  if (site.risk >= 80) return "#ff745f";
  if (site.risk >= 60) return "#f5bd4e";
  if (site.risk >= 40) return "#89c9c0";
  return "#dfff68";
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
      marker.bindTooltip(String(site.risk), {
        permanent: true,
        direction: "center",
        className: "garbage-risk-tooltip",
      });
      const popup = document.createElement("div");
      const identifier = document.createElement("strong");
      identifier.textContent = site.id;
      popup.append(identifier, document.createElement("br"));
      popup.append(document.createTextNode(site.place), document.createElement("br"));
      popup.append(document.createTextNode(`Risk ${site.risk}/100`));
      marker.bindPopup(popup);
      marker.on("click", () => onSelectRef.current(site));
      marker.addTo(markerLayer);
    }

    const selected = sites.find((site) => site.id === selectedId);
    if (selected) map.flyTo([selected.lat, selected.lon], Math.max(map.getZoom(), 14), { duration: 0.75 });
  }, [ready, selectedId, sites]);

  return (
    <div className="map-live-wrap">
      <div ref={containerRef} className="real-map" aria-label="OpenStreetMap showing reported garbage locations" />
      <div className="map-key">
        <span><i className="key-critical" /> Critical</span>
        <span><i className="key-watch" /> Watch</span>
        <span><i className="key-low" /> Clear</span>
      </div>
    </div>
  );
}
