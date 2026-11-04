import type { MetadataRoute } from "next";

/** Installable on phones and desktops (PWA): opens straight into the app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NEXORA ONE",
    short_name: "Business OS",
    description: "Kunden, Aufträge, Rechnungen, Finanzen",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b1220",
    theme_color: "#3b82f6",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    shortcuts: [
      { name: "Neue Rechnung", url: "/app/invoices/new" },
      { name: "Kunden", url: "/app/clients" },
      { name: "Kalender", url: "/app/calendar" },
    ],
  };
}
