/**
 * AGUS External Actions — Price Anomaly & Hallucination Detector
 *
 * Evaluates scraped product listings for statistical anomalies, suspicious
 * extreme prices, malformed currency values, and stale merchant data.
 */

import type { ProductListing } from "./types";

export interface AnomalyAnalysisResult {
  processedListings: ProductListing[];
  medianPriceKobo?: number;
  anomalyWarnings: string[];
}

export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Analyzes listings for price hallucinations, impossible values, and extreme outliers.
 */
export function detectPriceAnomalies(
  listings: ProductListing[]
): AnomalyAnalysisResult {
  if (listings.length === 0) {
    return { processedListings: [], anomalyWarnings: [] };
  }

  const validPrices = listings
    .map((l) => l.priceKobo)
    .filter((p) => p > 0 && p <= 1_000_000_000_00); // 1 billion NGN limit

  const medianPrice =
    validPrices.length > 0 ? calculateMedian(validPrices) : undefined;
  const anomalyWarnings: string[] = [];

  const processedListings = listings.map((listing) => {
    const warnings = [...listing.warnings];
    let confidence = listing.confidence;

    // 1. Zero or negative price
    if (listing.priceKobo <= 0) {
      warnings.push("price_anomaly:zero_or_negative_price");
      confidence = "low";
    }

    // 2. Implausibly high price (e.g. > ₦100,000,000 for standard retail)
    if (listing.priceKobo > 10_000_000_00) {
      warnings.push("price_anomaly:implausibly_high_price");
      confidence = "low";
    }

    // 3. Statistical outlier detection (requires at least 3 listings)
    if (medianPrice && validPrices.length >= 3 && listing.priceKobo > 0) {
      const ratio = listing.priceKobo / medianPrice;

      // Extreme low: < 20% of median (scam, accessory mistaken for main item, or misprice)
      if (ratio < 0.2) {
        warnings.push(
          `price_anomaly:extreme_low_outlier (${Math.round(ratio * 100)}% of median)`
        );
        confidence = "low";
      }

      // Extreme high: > 4.5x of median (bulk lot, misattributed bundle, or currency glitch)
      if (ratio > 4.5) {
        warnings.push(
          `price_anomaly:extreme_high_outlier (${Math.round(ratio * 100)}% of median)`
        );
        if (confidence === "high") confidence = "medium";
      }
    }

    // 4. Stale data detection (> 14 days old)
    try {
      const scrapedTime = new Date(listing.scrapedAt).getTime();
      const ageDays = (Date.now() - scrapedTime) / (1000 * 60 * 60 * 24);
      if (ageDays > 14) {
        warnings.push(`stale_listing:${Math.round(ageDays)}d_old`);
      }
    } catch {
      warnings.push("invalid_scraped_timestamp");
    }

    return {
      ...listing,
      confidence,
      warnings,
    };
  });

  const lowConfidenceCount = processedListings.filter(
    (l) => l.confidence === "low"
  ).length;
  if (lowConfidenceCount > 0 && lowConfidenceCount === listings.length) {
    anomalyWarnings.push(
      "All retrieved listings have low confidence or price anomalies; exercise caution."
    );
  }

  return {
    processedListings,
    medianPriceKobo: medianPrice,
    anomalyWarnings,
  };
}
