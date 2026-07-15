/**
 * Shared shape every search client (tavilyClient, serperClient, searxngClient) normalizes
 * its vendor-specific response into — callers (searchRouter.ts and its consumers) only
 * ever see this, never a vendor's raw field names (Tavily's `content`, Serper's `link` +
 * `snippet`, SearXNG's `content`, ...).
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchOutage = "no-key" | null;

export interface SearchClientResult {
  results: SearchResult[];
  outage: SearchOutage;
}
