/**
 * Shared shape the search client (searxngClient) normalizes its raw response into — callers
 * (searchRouter.ts and its consumers) only ever see this, never SearXNG's raw field names
 * (`content` for the snippet, etc.). Kept provider-neutral so a future backend could be
 * slotted back in without touching consumers.
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
