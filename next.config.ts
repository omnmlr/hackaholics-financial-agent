import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/product/[[...path]]": [
      "./migrations/0019_web_product.sql",
      "./migrations/0020_conversational_payments.sql",
      "./migrations/0021_web_preferences.sql",
    ],
    "/api/conversation": [
      "./migrations/0019_web_product.sql",
      "./migrations/0020_conversational_payments.sql",
      "./migrations/0021_web_preferences.sql",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "no-store" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'" +
              (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "") +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://sdk.api.pollar.xyz; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
