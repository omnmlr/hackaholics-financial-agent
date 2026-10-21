import { moneyQuantities } from "./model-led-agent/savings";

/** Recipient-local evidence. A model's proposed value cannot borrow a different
 * recipient's amount simply because both numbers occur somewhere in a request. */
export function paymentSegment(
  request: string,
  account: string | null,
  name: string,
) {
  if (new Set([...request.matchAll(/\b\d{10}\b/g)].map((m) => m[0])).size <= 1)
    return request;
  const segments = request
    .split(
      /\n+|;|\band\s+(?=(?:(?:send|transfer|pay)\s+)?(?:₦|NGN\s*)?\d)|\bthen\b/i,
    )
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 1) return request;
  const matching = account
    ? segments.filter((s) =>
        new RegExp(`(?<![\\w])${account}(?![\\w])`).test(s),
      )
    : name
      ? segments.filter((s) => s.toLowerCase().includes(name.toLowerCase()))
      : [];
  return matching.length === 1 ? matching[0] : "";
}

export function groundedPaymentAmounts(text: string) {
  const excluded = [
    ...text.matchAll(
      /\+\d[\d ()-]{8,}\d|\b\d{10,15}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:account(?:\s+number)?|phone|tel|reference|ref|invoice|bank(?:\s+code)?)\s*[:=#-]?\s*[A-Za-z0-9-]+/gi,
    ),
  ].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
  const candidates = moneyQuantities(text).filter((q) => {
    const before = text.slice(0, q.index),
      after = text.slice(q.end);
    if (excluded.some((x) => q.index < x.end && q.end > x.start)) return false;
    if (
      /\b(?:not|rather than|instead of|on|dated|reference|ref|phone|account|bank code)\s*[:=]?\s*$/i.test(
        before,
      )
    )
      return false;
    if (
      /^\s*(?:hours?|minutes?|days?|weeks?|months?|years?|recipients?)\b/i.test(
        after,
      )
    )
      return false;
    // Large unlabelled numbers and leading-zero identifiers never become money.
    const bare = q.text.trim();
    if (/^0\d+$/.test(bare) || /^\d{7,}$/.test(bare)) return false;
    const explicit =
      /₦|NGN|naira|\d\s*[hkm]\b|hundred|thousand|million/i.test(bare) ||
      /\bamount\s*[:=]?\s*$/i.test(before);
    const payment =
      /\b(?:send|pay|transfer|opay|wema|access|gtb|gtbank|uba)\b|\b\d{10}\b/i.test(
        text,
      );
    return q.amount > 0 && q.amount <= 1000000 && (explicit || payment);
  });
  const unique = [...new Set(candidates.map((q) => q.amount))];
  return unique.length === 1 ? unique : [];
}
