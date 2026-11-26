/** Logs accept only operational identifiers/codes, never request/provider bodies. */
export function operationalEvent(
  event: string,
  fields: {
    correlationId?: string;
    code?: string;
    jobId?: string;
    durationMs?: number;
  },
) {
  const safe: Record<string, unknown> = {
    event: /^[a-z_.]{1,80}$/.test(event) ? event : "invalid_event",
  };
  for (const key of ["correlationId", "jobId"] as const)
    if (fields[key] && /^[a-f0-9-]{36}$/.test(fields[key]!))
      safe[key] = fields[key];
  if (fields.code && /^[A-Z_]{1,80}$/.test(fields.code))
    safe.code = fields.code;
  if (Number.isFinite(fields.durationMs) && fields.durationMs! >= 0)
    safe.durationMs = fields.durationMs;
  console.log(JSON.stringify(safe));
}
