/** ISO 3166-1 alpha-2 → regional-indicator flag (secondary location cue). */
export function flagFromCode(code: string): string {
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}

const NAME_TO_CODE: Record<string, string> = {
  spain: "ES",
  france: "FR",
  italy: "IT",
  germany: "DE",
  austria: "AT",
  switzerland: "CH",
  portugal: "PT",
  belgium: "BE",
  netherlands: "NL",
  norway: "NO",
  sweden: "SE",
  finland: "FI",
  denmark: "DK",
  uk: "GB",
  "united kingdom": "GB",
  ireland: "IE",
  poland: "PL",
  czechia: "CZ",
  "czech republic": "CZ",
  slovakia: "SK",
  slovenia: "SI",
  croatia: "HR",
  hungary: "HU",
  romania: "RO",
  greece: "GR",
  turkey: "TR",
  morocco: "MA",
  usa: "US",
  "united states": "US",
  canada: "CA",
  mexico: "MX",
  chile: "CL",
  argentina: "AR",
  australia: "AU",
  "new zealand": "NZ",
  japan: "JP",
  iceland: "IS",
  andorra: "AD",
  luxembourg: "LU",
};

/** Parse "ES, FR" or "Spain, France" into unique ISO codes. */
export function parseCountryCodes(input: string): string[] {
  const parts = input
    .split(/[,;/|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (/^[A-Za-z]{2}$/.test(p)) {
      const c = p.toUpperCase();
      if (!out.includes(c)) out.push(c);
      continue;
    }
    const mapped = NAME_TO_CODE[p.toLowerCase()];
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}
