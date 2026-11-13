/** General-agent context keeps normal links and numerical task inputs. Financial
 * source disclosure retains its separate, stricter existing boundary. */
export function redactAgentText(text: string): string {
  return text
    .replace(
      /\b(?:uview(?:test)?1|uivk(?:test)?1|zxviewtestsapling1|zxviews1|secret-extended-key-(?:main|test)1)[a-z0-9]{20,}\b/gi,
      "[wallet key withheld]",
    )
    .replace(/\b(?:sk-|sk_|AIza)[A-Za-z0-9_-]{8,}/g, "[credential withheld]")
    .replace(
      /\b(?:(?:pollar|openai|gemini|paystack|zcash)[_ -])?(?:password|otp|pin|api[_ -]?key|secret[_ -]?key|access[_ -]?token|bearer[_ -]?token|private[_ -]?key|(?:wallet[_ -]?)?seed(?:[_ -]?phrase)?|mnemonic(?:[_ -]?phrase)?|recovery[_ -]?phrase|(?:full[_ -]?|incoming[_ -]?)?viewing[_ -]?key|spending[_ -]?key)\s*[:=]\s*[^\n,;]+/gi,
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
        /(?:password|otp|pin|apikey|secretkey|privatekey|seed|seedphrase|mnemonic|mnemonicphrase|recoveryphrase|accesstoken|viewingkey|spendingkey)$/i.test(
          key.replace(/[_ -]/g, ""),
        )
          ? "[credential withheld]"
          : modelData(item),
      ]),
    );
  return value;
}

/** Additional private-mode minimization, including addresses typed into chat. */
export function privateAgentText(text: string): string {
  return redactAgentText(text)
    .replace(
      /\b(?:ztestsapling1|zs1|utest1|u1)[a-z0-9]{30,}\b/gi,
      "[private recipient withheld]",
    )
    .replace(/\bG[A-Z2-7]{55}\b/g, "[wallet address withheld]")
    .replace(
      /\b(?:bc1|tb1|bcrt1)[a-z0-9]{20,}\b/gi,
      "[wallet address withheld]",
    )
    .replace(/\b0x[a-f0-9]{40}\b/gi, "[wallet address withheld]")
    .replace(
      /\b(?:raw[_ -]?|payment[_ -]?)?memo\s*[:=]\s*[^\n,;]+/gi,
      "[private memo withheld]",
    )
    .replace(/\bAGUS-[a-f0-9]{20}\b/gi, "[payment reference withheld]");
}
export function privateModelData(value: unknown): unknown {
  const safe = modelData(value);
  if (typeof safe === "string") return privateAgentText(safe);
  if (Array.isArray(safe)) return safe.map(privateModelData);
  if (safe && typeof safe === "object")
    return Object.fromEntries(
      Object.entries(safe).map(([key, item]) => [
        key,
        /(?:address|memo|unsignedxdr|signedxdr|viewingkey|spendingkey)$/i.test(
          key.replace(/[_ -]/g, ""),
        )
          ? "[private wallet metadata withheld]"
          : privateModelData(item),
      ]),
    );
  return safe;
}
