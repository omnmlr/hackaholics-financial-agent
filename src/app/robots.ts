import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const origin = process.env.APP_ORIGIN?.startsWith("https://")
    ? process.env.APP_ORIGIN
    : "https://agus.grindcity.app";
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms", "/support", "/auth"],
      disallow: ["/api/"],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
