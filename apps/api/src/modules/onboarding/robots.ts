/**
 * Minimal robots.txt support for the onboarding crawler (roadmap item 14): parse the
 * User-agent groups that apply to us, honor Disallow/Allow prefixes for pages beyond the
 * entry URL, and honor Crawl-delay (capped — see MAX_CRAWL_DELAY_MS) as the per-domain
 * politeness interval. Deliberately not a full REP implementation: prefix matching only,
 * no wildcards-in-the-middle beyond `*`, which covers the overwhelming majority of real
 * robots.txt files without pulling in a dependency.
 */

export const OUR_USER_AGENT = "polluxaonboardingbot";
const MAX_CRAWL_DELAY_MS = 2_000; // a site asking for 30s/page would blow the crawl budget — cap politeness at something sane

export interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
}

/** Rules that allow everything — used when there's no robots.txt or it fails to parse. */
export const ALLOW_ALL: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };

/**
 * Parses the groups applying to our bot (exact/prefix UA match) or `*`, most-specific
 * group wins: if a group names our bot explicitly, the `*` group is ignored, per the spec.
 */
export function parseRobots(robotsTxt: string): RobotsRules {
  interface Group { agents: string[]; disallow: string[]; allow: string[]; crawlDelay: number | null }
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], disallow: [], allow: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "disallow" && value) current.disallow.push(value);
    if (field === "allow" && value) current.allow.push(value);
    if (field === "crawl-delay") {
      const seconds = parseFloat(value);
      if (Number.isFinite(seconds) && seconds > 0) current.crawlDelay = seconds;
    }
  }

  const matches = (g: Group, ua: string) => g.agents.some((a) => a !== "*" && (ua.includes(a) || a.includes(ua)));
  const specific = groups.filter((g) => matches(g, OUR_USER_AGENT));
  const applicable = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));

  const rules: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
  for (const g of applicable) {
    rules.disallow.push(...g.disallow);
    rules.allow.push(...g.allow);
    if (g.crawlDelay !== null) {
      rules.crawlDelayMs = Math.min(Math.round(g.crawlDelay * 1000), MAX_CRAWL_DELAY_MS);
    }
  }
  return rules;
}

/** Longest-match prefix semantics with `*` wildcard and `$` end-anchor support. */
function matchLength(pattern: string, path: string): number {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split("*");
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "") continue;
    const found = i === 0 ? (path.startsWith(part) ? 0 : -1) : path.indexOf(part, pos);
    if (found === -1) return -1;
    pos = found + part.length;
  }
  if (anchored && pos !== path.length) return -1;
  return body.length;
}

/** Standard REP tie-break: the longest matching rule wins; Allow beats Disallow on equal length. */
export function isPathAllowed(rules: RobotsRules, pathname: string): boolean {
  let bestDisallow = -1;
  for (const d of rules.disallow) bestDisallow = Math.max(bestDisallow, matchLength(d, pathname));
  if (bestDisallow === -1) return true;
  let bestAllow = -1;
  for (const a of rules.allow) bestAllow = Math.max(bestAllow, matchLength(a, pathname));
  return bestAllow >= bestDisallow;
}
