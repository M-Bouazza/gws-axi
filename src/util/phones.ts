/**
 * French phone-number extraction from free text (email signatures).
 * The scanner PROPOSES candidates; contact creation stays explicit.
 */

export interface PhoneCandidate {
  /** Matched verbatim from the text (e.g. "+33 6 12 34 56 78"). */
  raw: string;
  /** Normalized 0-prefixed national form (e.g. "0612345678"). */
  normalized: string;
}

/**
 * FR mobile/landline patterns: leading 0[1-9] (or +33 / 0033) + 4 two-digit
 * groups separated by spaces, dots or dashes. Digit boundaries on both sides
 * exclude SIRET fragments, invoice amounts and reference numbers.
 */
const FR_PHONE_PATTERNS: string[] = [
  "\\+33[ .-]?[1-9](?:[ .-]?\\d{2}){4}(?!\\d)",
  "(?<![\\d.,])0[1-9](?:[ .-]?\\d{2}){4}(?!\\d)",
  "0033[ .-]?[1-9](?:[ .-]?\\d{2}){4}(?!\\d)",
];

/** Strip non-digits, convert +33/0033 prefixes to the 0-prefixed national form. */
export function normalizeFrPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+33")) return `0${digits.slice(2)}`;
  if (digits.startsWith("0033")) return `0${digits.slice(4)}`;
  return digits;
}

/** Dedupe candidates by normalized form, preserving first-seen order. */
export function extractPhones(text: string): PhoneCandidate[] {
  const seen = new Set<string>();
  const out: PhoneCandidate[] = [];
  for (const source of FR_PHONE_PATTERNS) {
    for (const m of text.matchAll(new RegExp(source, "g"))) {
      const raw = m[0].trim();
      const normalized = normalizeFrPhone(raw);
      if (normalized.length !== 10 || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ raw, normalized });
    }
  }
  return out;
}

interface GmailPart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[];
}

/**
 * Flatten a Gmail message payload into searchable text. Plain-text parts win
 * (joined first); text/html parts are tag-stripped and collected as fallback.
 * Quoted-reply sections (the "On ... wrote:" / "De : ... a écrit :" blocks and
 * >-prefixed lines) are STRIPPED so the scanner never picks up the OTHER
 * party's signature — only the actual sender's content.
 */
export function messageBodyText(payload: GmailPart): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (part: GmailPart): void => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      plain.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
    } else if (part.mimeType === "text/html" && part.body?.data) {
      const decoded = Buffer.from(part.body.data, "base64url").toString("utf8");
      html.push(
        decoded
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " "),
      );
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return stripQuotedReply([...plain, ...html].join("\n"));
}

/**
 * Cut the message at the first quoted-reply boundary. Email threads embed the
 * previous exchange below the current sender's content — without this strip,
 * the scanner picks up phone numbers from the REPLYING party's signature
 * (e.g. the account owner's own number appearing on every thread).
 */
export function stripQuotedReply(text: string): string {
  const markers = [
    /^-{3,}\s*(?:Message d'origine|Original Message|Forwarded message)\s*-{3,}/im,
    /^De\s*:/im,
    /^On .+ wrote\s*:/im,
    /^Le .+ a écrit\s*:/im,
    /^El .+ escribió\s*:/im,
    /^_{5,}\s*$/m,
    /^Von .+ schrieb\s*:/im,
  ];
  let cut = text.length;
  for (const marker of markers) {
    const idx = text.search(marker);
    if (idx !== -1 && idx < cut) cut = idx;
  }
  // Also cut at the first >-prefixed line (standard quoting).
  const gtMatch = text.match(/^>/m);
  if (gtMatch && gtMatch.index !== undefined && gtMatch.index < cut) cut = gtMatch.index;
  return text.slice(0, cut);
}
