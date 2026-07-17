import type { ResearchProviderInput } from "../types/index.js";
import { hostnameOf, sanitizeBusinessName } from "./support.js";

/** Single shared query-construction rule for every provider that hits a live external
 * search/fetch endpoint (Firecrawl search, Google Autocomplete, Ad Library APIs, ...):
 * prefer the business's real name, else fall back to its full domain — quoted as an exact
 * phrase either way, so a short bare word (e.g. "polluxa") can't fuzzy/stem-match unrelated
 * content (e.g. "Pollux") the way an unquoted, truncated hostname label can. The domain is
 * used in full (not `.split(".")[0]`) precisely because a longer, more specific string is a
 * stronger anchor than a truncated one.
 *
 * The name is first stripped of generic/placeholder tokens (sanitizeBusinessName): a seed or
 * demo record like "Polluxa Demo Business" would otherwise be searched as the exact phrase
 * `"Polluxa Demo Business"`, which matches nothing on the web and collapses every live provider
 * to its honest "no research performed" fallback. When nothing distinctive survives the strip
 * (e.g. a name that was ONLY filler), the domain anchor is used instead.
 */
export function buildSearchQuery(input: ResearchProviderInput): string {
  const domain = hostnameOf(input.url).replace(/^www\./i, "");
  const cleanName = input.businessName ? sanitizeBusinessName(input.businessName) : "";
  return cleanName ? `"${cleanName}"` : `"${domain}"`;
}
