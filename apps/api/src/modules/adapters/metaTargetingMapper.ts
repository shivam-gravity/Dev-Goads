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
  [key: string]: unknown;
}

export interface SavedAudience {
  id: string;
  workspaceId: string;
  name: string;
  ageMin: number;
  ageMax: number;
  gender: "all" | "male" | "female";
  locations: string[];
  interests: string[];
  exclusions: string[];
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
export async function resolveInterests(accessToken: string, freeTextInterests: string[]): Promise<{ id: string; name: string }[]> {
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
  if (includeInterests.length) spec.flexible_spec = [{ interests: includeInterests.map((i) => ({ id: i.id })) }];
  if (excludeInterests.length) spec.exclusions = { interests: excludeInterests.map((i) => ({ id: i.id })) };
  return spec;
}

export interface ReachEstimate {
  usersLowerBound: number;
  usersUpperBound: number;
  source: "meta" | "heuristic";
}

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
