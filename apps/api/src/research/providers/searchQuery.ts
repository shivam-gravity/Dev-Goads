import type { ResearchProviderInput } from "../types/index.js";
import { hostnameOf } from "./support.js";

/** Single shared query-construction rule for every provider that hits a live external
 * search/fetch endpoint (Firecrawl search, Google Autocomplete, Ad Library APIs, ...):
 * prefer the business's real name, else fall back to its full domain — quoted as an exact
 * phrase either way, so a short bare word (e.g. "polluxa") can't fuzzy/stem-match unrelated
 * content (e.g. "Pollux") the way an unquoted, truncated hostname label can. The domain is
 * used in full (not `.split(".")[0]`) precisely because a longer, more specific string is a
 * stronger anchor than a truncated one.
 */
export function buildSearchQuery(input: ResearchProviderInput): string {
  const domain = hostnameOf(input.url).replace(/^www\./i, "");
  return input.businessName ? `"${input.businessName}"` : `"${domain}"`;
}
