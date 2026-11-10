/**
 * Reads one line of pasted roadmap text. Forgiving on purpose, so lists copied from an AI chat,
 * a problem sheet or a notes app work as they are:
 *
 *   # Week 1 — Arrays                     → section heading
 *   - https://leetcode.com/problems/x/    → link (bullets, "1." / "1)" numbering, checkboxes stripped)
 *   Consistent hashing — https://… (45m)  → link with its own title and time
 *   [Consistent hashing](https://…)       → markdown link
 *   Design YouTube (1h 30m)               → topic with its own time
 *
 * A time is only read in brackets at the very end of the line, so titles like "Top 10 patterns" stay intact.
 */
export type RoadmapLine =
  | { kind: "heading"; title: string }
  | { kind: "item"; title: string | null; url: string | null; minutes: number | null };

const MIN_MINUTES = 5;
const MAX_MINUTES = 600;

const LIST_MARKER = /^(?:[-*•+]|\d{1,3}[.)]|\[[ xX]\])\s+/;
const DURATION = /[([]\s*((?:\d+(?:\.\d+)?\s*h(?:ours?|rs?)?\s*)?(?:\d+\s*m(?:in(?:ute)?s?)?)?)\s*[)\]]\s*$/i;
const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/i;
const BARE_URL = /<?(https?:\/\/[^\s<>]+)>?/i;
const EDGE_SEPARATORS = /^[\s\-–—:|·,.;!?]+|[\s\-–—:|·,.;!?]+$/g;

/** "45m", "45 min", "1h", "1.5 hours", "1h 30m" → minutes (clamped), or null. */
export function parseDuration(text: string): number | null {
  const h = text.match(/(\d+(?:\.\d+)?)\s*h/i);
  const m = text.match(/(\d+)\s*m/i);
  if (!h && !m) return null;
  const total = Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0));
  if (!total) return null;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, total));
}

const clean = (s: string) =>
  s
    .replace(/\*\*|__|`/g, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(EDGE_SEPARATORS, "")
    .replace(/\s+/g, " ")
    .trim();

/** Drops punctuation that ends a sentence rather than the URL (keeps a ")" that closes a "(" in it). */
function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?]+$/, "");
  while (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1);
  return u;
}

/** Returns null for lines with nothing to add (blank, or only a bullet). */
export function parseRoadmapLine(raw: string): RoadmapLine | null {
  let line = raw.trim();
  const heading = line.match(/^#+\s*(.*)$/);
  if (heading) {
    const title = clean(heading[1]!);
    return title ? { kind: "heading", title } : null;
  }
  while (LIST_MARKER.test(line)) line = line.replace(LIST_MARKER, "");

  let minutes: number | null = null;
  const d = line.match(DURATION);
  if (d && d[1]!.trim()) {
    minutes = parseDuration(d[1]!);
    if (minutes !== null) line = line.slice(0, d.index);
  }

  let url: string | null = null;
  let title: string;
  const md = line.match(MD_LINK);
  if (md) {
    url = md[2]!;
    const rest = clean(line.replace(md[0], ""));
    title = rest || clean(md[1]!);
  } else {
    const bare = line.match(BARE_URL);
    if (bare) {
      url = trimUrl(bare[1]!);
      // Whatever trimUrl dropped (a closing ")" or "."), put back so the title is cleaned with it.
      title = clean(line.replace(bare[0], bare[1]!.slice(url.length)));
    } else {
      title = clean(line);
    }
  }
  if (!url && !title) return null;
  return { kind: "item", title: title || null, url, minutes };
}
