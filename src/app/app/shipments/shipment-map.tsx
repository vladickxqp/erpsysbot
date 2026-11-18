"use client";

import "leaflet/dist/leaflet.css";
import type { CircleMarker, Map as LeafletMap } from "leaflet";
import { useEffect, useRef } from "react";
import type { MapParcel } from "@/server/geo";

/** Problem red, out for delivery amber, delivered green, the rest blue. */
export function colorOf(p: Pick<MapParcel, "status" | "problem">): string {
  if (p.problem || ["EXCEPTION", "FAILED_ATTEMPT", "LOST", "RETURNED_TO_SENDER"].includes(p.status)) return "#dc2626";
  if (p.status === "OUT_FOR_DELIVERY") return "#d97706";
  if (p.status === "DELIVERED") return "#16a34a";
  return "#2563eb";
}

type Label = (p: MapParcel) => { title: string; lines: string[] };

/** OpenStreetMap with one point per parcel that has a known place; `selected` flies there. */
export function ShipmentMap({ parcels, selected, label, onSelect }: { parcels: MapParcel[]; selected: string | null; label: Label; onSelect: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef(new Map<string, CircleMarker>());
  const labelRef = useRef(label);
  const selectRef = useRef(onSelect);
  useEffect(() => {
    labelRef.current = label;
    selectRef.current = onSelect;
  });

  useEffect(() => {
    let cancelled = false;
    const own = markers.current;
    void import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      const m = L.map(box.current, { scrollWheelZoom: false, worldCopyJump: true }).setView([51.1, 10.4], 5);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      }).addTo(m);
      const placed = parcels.filter((p) => p.lat !== null && p.lng !== null);
      // Parcels at the same place sit side by side, not on top of each other.
      const seen = new Map<string, number>();
      for (const p of placed) {
        const key = `${p.lat},${p.lng}`;
        const n = seen.get(key) ?? 0;
        seen.set(key, n + 1);
        const shift = n ? 0.02 * Math.ceil(n / 2) * (n % 2 ? 1 : -1) : 0;
        const { title, lines } = labelRef.current(p);
        const popup = document.createElement("div");
        const head = document.createElement("a");
        head.href = `/app/orders/${p.orderId}`;
        head.textContent = title;
        head.style.fontWeight = "600";
        popup.append(head);
        for (const line of lines) {
          const row = document.createElement("div");
          row.textContent = line;
          popup.append(row);
        }
        const marker = L.circleMarker([p.lat! + shift, p.lng! + shift], { radius: 8, color: "#ffffff", weight: 2, fillColor: colorOf(p), fillOpacity: 0.95 })
          .bindPopup(popup)
          .on("click", () => selectRef.current(p.id))
          .addTo(m);
        own.set(p.id, marker);
      }
      if (placed.length) m.fitBounds(L.latLngBounds(placed.map((p) => [p.lat!, p.lng!] as [number, number])).pad(0.3), { maxZoom: 9 });
      map.current = m;
    });
    return () => {
      cancelled = true;
      own.clear();
      map.current?.remove();
      map.current = null;
    };
  }, [parcels]);

  useEffect(() => {
    const marker = selected ? markers.current.get(selected) : undefined;
    if (!marker || !map.current) return;
    map.current.flyTo(marker.getLatLng(), Math.max(map.current.getZoom(), 8), { duration: 0.6 });
    marker.openPopup();
  }, [selected]);

  return <div ref={box} className="relative z-0 h-[420px] w-full overflow-hidden rounded-xl border" />;
}
