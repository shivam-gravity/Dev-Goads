/**
 * Detection rules for the stale-competitor-domain cleanup (cleanupStaleCompetitorDomains.ts)
 * — pulled into their own side-effect-free module so they can be unit-tested (and stay locked
 * down) WITHOUT importing Prisma/fs. These deliberately mirror migrateCompetitorMemoryUrls.ts's
 * coreName/isUntrustworthy as a FROZEN snapshot of the rule being applied — kept as their own
 * copy, not a shared import, for the same reason that script gives: a cleanup's detection should
 * not silently change underneath it if the live pipeline's helpers are later refactored.
 *
 * Once Bucket B (real homepage resolution) lands these run against genuine competitor domains,
 * so a false positive here would CLEAR a real homepage — hence the permanent unit test.
 */

const CORPORATE_SUFFIXES = /\b(inc|incorporated|corp|corporation|holdings|ltd|llc|co|company|group)\b\.?/g;

/** Normalizes a competitor name to its distinctive core: lowercased, parentheticals and
 * corporate suffixes and punctuation stripped, whitespace collapsed. "PayPal Holdings, Inc." ->
 * "paypal"; "Microsoft Dynamics 365 Sales" -> "microsoft dynamics 365 sales". */
export function coreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(CORPORATE_SUFFIXES, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bare-hostname form of a URL (www. stripped, lowercased), or null if unparseable. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The relational `competitors` table stores only a bare `domain` hostname (no path), so the
 * root-path signal migrateCompetitorMemoryUrls.ts also used can't apply — detection reduces to
 * the name-match half: a stored domain is a citation host (flag it) if its hostname shares NO
 * significant token with the competitor's own name.
 *
 * "Significant" = a core-name word of length >= 4, OR the whole core name flattened (spaces
 * removed) as a single token — so both "salesforce" (one word) and a multi-word "microsoftdynamics"
 * style flat match are covered. Words shorter than 4 chars are ignored to avoid a stray "co"/"365"
 * coincidentally matching an unrelated host.
 *
 *   PayPal / businesschronicler.com  -> "paypal" not in host                 -> mismatch (flag)
 *   Helcim / forbes.com              -> "helcim" not in host                 -> mismatch (flag)
 *   Stripe / stripe.com              -> host contains "stripe"               -> match   (keep)
 *   Microsoft Dynamics 365 / …dynamics… -> host contains "dynamics"          -> match   (keep)
 *
 * `domainHost` is expected already bare+lowercased (as stored in Competitor.domain). An
 * empty/blank host or a name with no significant token both count as a mismatch — nothing to
 * trust, so err toward flagging (recoverable via the backup, exactly like the original migration).
 */
export function domainMismatchesName(name: string, domainHost: string): boolean {
  const host = domainHost.trim().toLowerCase();
  if (!host) return true; // no host to trust
  const core = coreName(name);
  const significantWords = core.split(" ").filter((w) => w.length >= 4);
  const flat = core.replace(/\s+/g, "");
  const matches = significantWords.some((w) => host.includes(w)) || (flat.length >= 4 && host.includes(flat));
  return !matches;
}

/** Whether a URL should be treated as untrustworthy for a competitor's OWN-site url field —
 * the full-URL rule (used for kind:"competitor" memory rows, which store a complete url, not a
 * bare host). Frozen copy of migrateCompetitorMemoryUrls.ts's rule: flag if the hostname shares
 * no significant token with the name, OR the url isn't a bare root-path (a genuine homepage
 * essentially always is; every audited bad row was a deep-linked article). Either signal flags. */
export function isUntrustworthyUrl(name: string, url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return true; // unparseable — nothing to trust
  if (domainMismatchesName(name, host)) return true;
  try {
    const pathname = new URL(url).pathname;
    const isRootPath = pathname === "" || pathname === "/";
    return !isRootPath;
  } catch {
    return true;
  }
}
