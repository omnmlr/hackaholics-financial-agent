import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.APP_ORIGIN?.startsWith("https://")
    ? process.env.APP_ORIGIN
    : "https://agus.grindcity.app";
  const lastModified = new Date("2026-11-25T00:00:00.000Z");
  return ["", "/privacy", "/terms", "/support", "/auth"].map((path) => ({
    url: `${origin}${path || "/"}`,
    lastModified,
  }));
}
