import type { MetadataRoute } from "next";

// Web app manifest: lets phones "Add to Home Screen" and open Lumora full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lumora AI",
    short_name: "Lumora",
    description: "AI roleplay & companions · โรลเพลย์และเพื่อนคู่ใจ AI",
    start_url: "/discover",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0a12",
    theme_color: "#0b0a12",
    lang: "th",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
