import { logger } from "../modules/logger/logger.js";

// PullPush.io — a free, unauthenticated third-party archive of Reddit submissions/comments
// (the Pushshift successor). Reddit's own JSON endpoints now reject anonymous programmatic
// access outright (confirmed live: even a compliant descriptive User-Agent gets a 403 on
// reddit.com/*.json), and Firecrawl's scrape of individual reddit.com threads hits the same
// wall — PullPush sidesteps both since it's a separate archive, not Reddit's own
// infrastructure. Mirrors firecrawlClient.ts's fetch + AbortController timeout +
// graceful-null-on-failure shape, minus any credit budgeting (no API key, no per-call cost).
const BASE_URL = "https://api.pullpush.io/reddit/search";
const REQUEST_TIMEOUT_MS = 8000;

interface PullPushResponse<T> {
  data: T[];
}

interface PullPushSubmission {
  title: string;
  permalink: string;
  selftext?: string;
  created_utc: number;
}

interface PullPushComment {
  body: string;
  permalink: string;
  created_utc: number;
}

async function get<T>(endpoint: "submission" | "comment", params: Record<string, string | number>): Promise<PullPushResponse<T> | null> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/${endpoint}/?${query}`, { signal: controller.signal });
    if (!res.ok) {
      logger.warn(`pullpushClient: GET /${endpoint} responded with ${res.status}`);
      return null;
    }
    return (await res.json()) as PullPushResponse<T>;
  } catch (err) {
    logger.warn(`pullpushClient: GET /${endpoint} failed`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface RedditThreadResult {
  title: string;
  url: string;
  selftext: string;
  created_utc: number;
}

/**
 * Searches PullPush's submission archive (api.pullpush.io/reddit/search/submission/) for
 * posts matching `query`. Returns `[]` (not null) when the search legitimately found
 * nothing — that's a valid outcome, not a failure — and `null` only on an actual request
 * failure (timeout, non-2xx, network error), so callers can tell "nothing found" apart from
 * "couldn't check." `url` is built from `permalink` (always a reddit.com-relative discussion
 * path) rather than PullPush's own `url` field, which for link (non-self) posts points at
 * the external site being linked to, not the Reddit discussion itself.
 *
 * Note: PullPush is a historical archive (Pushshift's successor), not real-time — a post
 * from the last few hours may not be indexed yet. Accepted trade-off, not a bug to work around.
 */
export async function searchRedditThreads(query: string, limit = 3): Promise<RedditThreadResult[] | null> {
  const result = await get<PullPushSubmission>("submission", { q: query, size: limit });
  if (!result) return null;
  return result.data.map((post) => ({
    title: post.title,
    url: `https://www.reddit.com${post.permalink}`,
    selftext: post.selftext ?? "",
    created_utc: post.created_utc,
  }));
}

/** Searches PullPush's comment archive (api.pullpush.io/reddit/search/comment/) — not
 * currently called by any provider, kept alongside searchRedditThreads for symmetry (both
 * endpoints PullPush exposes) and for future use. Same null-on-failure / []-on-no-results
 * contract as searchRedditThreads. */
export async function searchRedditComments(query: string, limit = 3): Promise<{ body: string; url: string; created_utc: number }[] | null> {
  const result = await get<PullPushComment>("comment", { q: query, size: limit });
  if (!result) return null;
  return result.data.map((comment) => ({
    body: comment.body,
    url: `https://www.reddit.com${comment.permalink}`,
    created_utc: comment.created_utc,
  }));
}
