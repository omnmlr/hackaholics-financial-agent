/** General-agent context keeps normal links and numerical task inputs. Financial
 * source disclosure retains its separate, stricter existing boundary. */
export function redactAgentText(text: string): string {
  return text
    .replace(/\b(?:sk-|AIza)[A-Za-z0-9_-]{8,}/g, "[credential withheld]")
    .replace(
      /\b(?:password|otp|pin|api[_ -]?key|access[_ -]?token|bearer[_ -]?token|private[_ -]?key|seed[_ -]?phrase)\s*[:=]\s*[^\n,;]+/gi,
      "[credential withheld]",
    )
    .replace(/https?:\/\/[^\s<>]+/gi, (raw) => {
      try {
        const url = new URL(raw);
        if (url.username || url.password) {
          url.username = "";
          url.password = "";
        }
        for (const key of [...url.searchParams.keys()])
          if (
            /^(?:token|key|api[_-]?key|secret|password|code|signature|access_token|auth)$/i.test(
              key,
            )
          )
            url.searchParams.set(key, "WITHHELD");
        if (/(?:token|key|secret|password|auth)=/i.test(url.hash))
          url.hash = "";
        return url.toString();
      } catch {
        return "[invalid URL withheld]";
      }
    });
}
export function modelData(value: unknown): unknown {
  if (typeof value === "string") return redactAgentText(value);
  if (Array.isArray(value)) return value.map(modelData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(?:password|otp|pin|apiKey|api_key|privateKey|private_key|seedPhrase|seed_phrase|accessToken|access_token)$/i.test(
          key,
        )
          ? "[credential withheld]"
          : modelData(item),
      ]),
    );
  return value;
}
