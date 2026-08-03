/** Keep trip titles short — Day/Place noise belongs elsewhere. */
export function cleanUltraTitle(name: string): string {
  let s = (name || "").trim();
  if (!s) return "Untitled trip";
  s = s.split(/\s+[—–\-]\s+Day\s*\d+/i)[0];
  s = s.split(/\s+Day\s*\d+\b/i)[0];
  s = s.split(/\s*[—–\-]\s*\(?\s*Place\b/i)[0];
  s = s.split(/\s*\(\s*Place\b/i)[0];
  s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");
  s = s.replace(/[✅❌⭐️]/g, "");
  s = s.replace(/\s{2,}/g, " ").replace(/^[\s\-—–|&]+|[\s\-—–|&]+$/g, "");
  return s || "Untitled trip";
}

/** Strip Strava ``(1/2)`` recording-part markers from trip day titles. */
export function cleanDayTitle(name: string): string {
  let s = (name || "").trim();
  if (!s) return "";
  s = s.replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)/g, "");
  s = s.replace(/\s{2,}/g, " ").replace(/^[\s\-—–|&]+|[\s\-—–|&]+$/g, "");
  return s || (name || "").trim();
}
