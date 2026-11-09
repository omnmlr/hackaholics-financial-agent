/**
 * AGUS External Actions — Web Content Sanitizer & Prompt Injection Defense
 *
 * Sanitizes scraped product listings, merchant reviews, and web text.
 * Prevents prompt injection, malicious link insertion, zero-width attacks,
 * and instruction overrides before untrusted text reaches the LLM context.
 */

// Patterns that attempt to hijack LLM behavior or inject system-level commands
const INJECTION_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  {
    regex: /(?:ignore|disregard|forget|bypass)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i,
    name: "instruction_override",
  },
  {
    regex: /(?:system\s*prompt|system\s*instructions|developer\s*mode|jailbreak|DAN\s*mode)/i,
    name: "system_mode_exploit",
  },
  {
    regex: /^(?:system|assistant|developer|user)\s*:\s*/im,
    name: "role_impersonation",
  },
  {
    regex: /<\s*(?:system|instruction|prompt|context)[^>]*>[\s\S]*?<\s*\/\s*(?:system|instruction|prompt|context)\s*>/i,
    name: "pseudo_xml_instructions",
  },
  {
    regex: /(?:transfer|send|drain|authorize|approve)\s+(?:\d+|all|sol|kobo|naira|ngn|usdc)/i,
    name: "unauthorized_financial_instruction",
  },
  {
    regex: /(?:new\s+rule|from\s+now\s+on\s+you\s+must|your\s+new\s+task\s+is\s+to)/i,
    name: "behavioral_redirection",
  },
];

// Dangerous protocol schemes
const DANGEROUS_PROTOCOLS = /^(?:javascript|vbscript|data|file|about):/i;

// Zero-width characters and invisible control codes
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF\u202A-\u202E\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

// HTML tags and comments
const HTML_TAGS = /<[^>]*>/g;

export interface SanitizationResult {
  sanitized: string;
  injectionDetected: boolean;
  warnings: string[];
}

/**
 * Strips invisible chars, removes HTML, defangs injection attacks, and limits length.
 */
export function sanitizeScrapedText(
  input: string | undefined | null,
  maxLength = 1000
): SanitizationResult {
  if (!input) {
    return { sanitized: "", injectionDetected: false, warnings: [] };
  }

  const warnings: string[] = [];
  let injectionDetected = false;

  // 1. Remove invisible Unicode and control characters
  let cleaned = input.replace(INVISIBLE_CHARS, "");

  // 2. Remove script / style blocks completely
  cleaned = cleaned
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, " ");

  // 3. Check for prompt injection patterns before stripping tags
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.regex.test(cleaned)) {
      injectionDetected = true;
      warnings.push(`potential_prompt_injection:${pattern.name}`);
      // Defang matching text by neutral replacement
      cleaned = cleaned.replace(pattern.regex, "[FILTERED_INSTRUCTION]");
    }
  }

  // 4. Strip remaining HTML tags
  cleaned = cleaned.replace(HTML_TAGS, " ");

  // 5. Decode basic HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 6. Collapse excessive whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // 7. Enforce length cap
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength).trimEnd() + "...";
  }

  return {
    sanitized: cleaned,
    injectionDetected,
    warnings,
  };
}

/**
 * Validates and sanitizes a URL. Only http and https protocols are permitted.
 */
export function sanitizeUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (DANGEROUS_PROTOCOLS.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}
