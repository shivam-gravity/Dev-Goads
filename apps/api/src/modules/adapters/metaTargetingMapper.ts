import type { SavedAudience } from "../audience/savedAudienceService.js";
import { listSavedAudiences } from "../audience/savedAudienceService.js";
import { logger } from "../logger/logger.js";

const GRAPH_VERSION = "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaTargetingSpec {
  age_min: number;
  age_max: number;
  genders?: number[];
  geo_locations: { countries: string[] };
  flexible_spec?: { interests: { id: string }[] }[];
  exclusions?: { interests: { id: string }[] };
  // Passed as opaque JSON into AdAdapter's Record<string, unknown> targeting param.
  [key: string]: unknown;
}

const GENDER_CODES: Record<SavedAudience["gender"], number[] | undefined> = {
  all: undefined,
  male: [1],
  female: [2],
};

/**
 * The Graph API rejects free-text interests — targeting requires Meta's own numeric
 * interest IDs. Resolves each free-text interest via the interest search endpoint,
 * best-effort: an interest with no match is dropped (logged) rather than failing the
 * whole campaign launch over one unresolvable term.
 */
async function resolveInterests(accessToken: string, freeTextInterests: string[]): Promise<{ id: string; name: string }[]> {
  const resolved: { id: string; name: string }[] = [];
  for (const term of freeTextInterests) {
    try {
      const url = `${GRAPH_BASE}/search?${new URLSearchParams({ type: "adinterest", q: term, access_token: accessToken }).toString()}`;
      const res = await fetch(url);
      const json = (await res.json()) as { data?: { id: string; name: string }[]; error?: { message: string } };
      if (!res.ok || json.error) throw new Error(json.error?.message ?? `status ${res.status}`);
      const match = json.data?.[0];
      if (match) resolved.push(match);
      else logger.warn(`Meta interest search found no match for "${term}" — dropping from targeting spec`);
    } catch (err) {
      logger.warn(`Meta interest search failed for "${term}" — dropping from targeting spec`, err);
    }
  }
  return resolved;
}

/**
 * Maps a SavedAudience (age/gender/location/free-text interests) into a Meta Ad Set
 * `targeting` spec. Pass `accessToken: null` for mock/offline mode (no connected ad
 * account yet) — interest resolution requires a live Graph API call, so it's skipped
 * and the spec falls back to age/gender/geo only, same reduced-fidelity mock pattern
 * every other adapter in this codebase already uses.
 */
export async function buildMetaTargetingSpec(accessToken: string | null, audience: SavedAudience): Promise<MetaTargetingSpec> {
  const [includeInterests, excludeInterests] = accessToken
    ? await Promise.all([
        resolveInterests(accessToken, audience.interests),
        audience.exclusions.length ? resolveInterests(accessToken, audience.exclusions) : Promise.resolve([]),
      ])
    : [[], []];

  const spec: MetaTargetingSpec = {
    age_min: audience.ageMin,
    age_max: audience.ageMax,
    genders: GENDER_CODES[audience.gender],
    geo_locations: { countries: audience.locations.length ? audience.locations : ["US"] },
  };
  // flexible_spec/exclusions only accept {"id": "..."} — Meta rejects extra fields like
  // `name` on an interest object, so the search result's name is dropped here.
  if (includeInterests.length) spec.flexible_spec = [{ interests: includeInterests.map((i) => ({ id: i.id })) }];
  if (excludeInterests.length) spec.exclusions = { interests: excludeInterests.map((i) => ({ id: i.id })) };
  return spec;
}

export interface ReachEstimate {
  usersLowerBound: number;
  usersUpperBound: number;
  source: "meta" | "heuristic";
}

/** Real reach estimate via Meta's delivery_estimate endpoint, once the workspace has a connected ad account. */
export async function fetchMetaReachEstimate(accessToken: string, adAccountId: string, targeting: MetaTargetingSpec): Promise<ReachEstimate> {
  const url = `${GRAPH_BASE}/act_${adAccountId}/delivery_estimate?${new URLSearchParams({
    targeting_spec: JSON.stringify(targeting),
    access_token: accessToken,
  }).toString()}`;
  const res = await fetch(url);
  const json = (await res.json()) as { data?: { estimate_mau_lower_bound: number; estimate_mau_upper_bound: number }[]; error?: { message: string } };
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `Meta delivery_estimate returned ${res.status}`);
  const row = json.data?.[0];
  if (!row) throw new Error("Meta delivery_estimate returned no data");
  return { usersLowerBound: row.estimate_mau_lower_bound, usersUpperBound: row.estimate_mau_upper_bound, source: "meta" };
}

const BROAD_DEFAULT_TARGETING: MetaTargetingSpec = {
  age_min: 18,
  age_max: 65,
  geo_locations: { countries: ["US"] },
};

/**
 * Strategy-generated variants carry a free-text `audienceName` (e.g. "Lookalike of
 * existing customers") that isn't structurally linked to a SavedAudience record — the
 * strategy engine and the audience library evolved separately. Best-effort bridge: if a
 * SavedAudience in this workspace happens to share the name, use its real targeting;
 * otherwise fall back to a broad default rather than failing the whole campaign launch.
 */
export async function resolveAudienceTargetingForWorkspace(
  workspaceId: string,
  audienceName: string | undefined,
  accessToken: string | null
): Promise<MetaTargetingSpec> {
  if (audienceName) {
    const audiences = await listSavedAudiences(workspaceId);
    const match = audiences.find((a) => a.name.toLowerCase() === audienceName.toLowerCase());
    if (match) return buildMetaTargetingSpec(accessToken, match);
    logger.info(`No SavedAudience matches strategy audience "${audienceName}" — using broad default targeting`);
  }
  return BROAD_DEFAULT_TARGETING;
}

/** Heuristic fallback when no Meta ad account is connected yet — clearly labeled as an estimate, not a real query. */
export function estimateReachHeuristic(audience: SavedAudience): ReachEstimate {
  const ageSpan = Math.max(1, audience.ageMax - audience.ageMin);
  const specificityPenalty = audience.interests.length * 1.5 + audience.exclusions.length * 1 + (audience.locations.length || 1) * 0.5;
  const base = Math.max(0.5, ageSpan * 0.4 - specificityPenalty);
  return {
    usersLowerBound: Math.round(base * 0.8 * 1_000_000),
    usersUpperBound: Math.round(base * 1.4 * 1_000_000),
    source: "heuristic",
  };
}
