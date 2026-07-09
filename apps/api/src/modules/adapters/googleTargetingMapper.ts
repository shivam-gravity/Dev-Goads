import type { SavedAudience } from "../audience/savedAudienceService.js";
import { logger } from "../logger/logger.js";
import { listSavedAudiences } from "../audience/savedAudienceService.js";

const ADS_API_VERSION = "v24";

export interface GoogleCampaignTargeting {
  /** Geo target constant resource names, e.g. "geoTargetConstants/2840" (US). */
  geoTargetConstants: string[];
  languageConstant: string;
  // Passed as opaque JSON into AdAdapter's Record<string, unknown> targeting param.
  [key: string]: unknown;
}

export interface GoogleAdGroupTargeting {
  ageRanges: string[];
  genders: string[];
  /** Free-text interests become broad-match keywords — Search campaigns target keywords, not interest categories. */
  keywords: string[];
  // Passed as opaque JSON into AdAdapter's Record<string, unknown> targeting param.
  [key: string]: unknown;
}

export interface GoogleTargeting {
  campaign: GoogleCampaignTargeting;
  adGroup: GoogleAdGroupTargeting;
}

const AGE_BUCKETS: { name: string; min: number; max: number }[] = [
  { name: "AGE_RANGE_18_24", min: 18, max: 24 },
  { name: "AGE_RANGE_25_34", min: 25, max: 34 },
  { name: "AGE_RANGE_35_44", min: 35, max: 44 },
  { name: "AGE_RANGE_45_54", min: 45, max: 54 },
  { name: "AGE_RANGE_55_64", min: 55, max: 64 },
  { name: "AGE_RANGE_65_UP", min: 65, max: 200 },
];

function ageRangeBuckets(ageMin: number, ageMax: number): string[] {
  return AGE_BUCKETS.filter((b) => b.min <= ageMax && b.max >= ageMin).map((b) => b.name);
}

const GENDER_TYPES: Record<SavedAudience["gender"], string[]> = {
  all: ["MALE", "FEMALE", "UNDETERMINED"],
  male: ["MALE"],
  female: ["FEMALE"],
};

// Static fallback for mock/offline mode — mirrors CampaignGenerator.tsx's COUNTRY_OPTIONS.
// Google Ads criterion IDs are fixed and public (geotargets.csv in their API docs), not
// something that changes, so a small hardcoded table is reasonable rather than requiring
// a live API call just to resolve "United States" -> 2840.
const STATIC_GEO_TARGET_IDS: Record<string, string> = {
  "united states": "2840", us: "2840", usa: "2840",
  "united kingdom": "2826", uk: "2826", gb: "2826",
  canada: "2124", ca: "2124",
  australia: "2036", au: "2036",
  india: "2356", in: "2356",
  germany: "2276", de: "2276",
  france: "2250", fr: "2250",
  brazil: "2076", br: "2076",
  japan: "2392", jp: "2392",
  "united arab emirates": "2784", uae: "2784", ae: "2784",
  singapore: "2702", sg: "2702",
  mexico: "2484", mx: "2484",
};

const DEFAULT_GEO_TARGET_ID = STATIC_GEO_TARGET_IDS["united states"];

async function resolveGeoTargetConstants(accessToken: string | null, developerToken: string | null, locationNames: string[]): Promise<string[]> {
  if (!locationNames.length) return [`geoTargetConstants/${DEFAULT_GEO_TARGET_ID}`];

  if (!accessToken || !developerToken) {
    return locationNames.map((name) => `geoTargetConstants/${STATIC_GEO_TARGET_IDS[name.trim().toLowerCase()] ?? DEFAULT_GEO_TARGET_ID}`);
  }

  try {
    const res = await fetch(`https://googleads.googleapis.com/${ADS_API_VERSION}/geoTargetConstants:suggest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
      },
      body: JSON.stringify({ locationNames: { names: locationNames }, locale: "en" }),
    });
    const json = (await res.json()) as { geoTargetConstantSuggestions?: { geoTargetConstant?: { resourceName?: string } }[] };
    if (!res.ok) throw new Error(`geoTargetConstants:suggest returned ${res.status}`);
    const resolved = (json.geoTargetConstantSuggestions ?? [])
      .map((s) => s.geoTargetConstant?.resourceName)
      .filter((n): n is string => Boolean(n));
    if (resolved.length) return resolved;
    logger.warn(`No Google geo target match for [${locationNames.join(", ")}] — falling back to static table`);
  } catch (err) {
    logger.warn(`Google geoTargetConstants:suggest failed — falling back to static table`, err);
  }
  return locationNames.map((name) => `geoTargetConstants/${STATIC_GEO_TARGET_IDS[name.trim().toLowerCase()] ?? DEFAULT_GEO_TARGET_ID}`);
}

/**
 * Builds campaign-level (geo/language) targeting directly from explicit location names —
 * used by the campaign builder, which collects locations as ad-hoc campaign state rather
 * than requiring a saved audience first (see buildGoogleTargeting below for the
 * SavedAudience-driven path).
 */
export async function buildGoogleCampaignTargetingFromLocations(
  accessToken: string | null,
  developerToken: string | null,
  locations: string[]
): Promise<GoogleCampaignTargeting> {
  const geoTargetConstants = await resolveGeoTargetConstants(accessToken, developerToken, locations);
  return { geoTargetConstants, languageConstant: "languageConstants/1000" /* English */ };
}

/** Maps a SavedAudience into Google Ads campaign-level (geo/language) + ad-group-level (age/gender/keywords) targeting. */
export async function buildGoogleTargeting(
  accessToken: string | null,
  developerToken: string | null,
  audience: SavedAudience
): Promise<GoogleTargeting> {
  const geoTargetConstants = await resolveGeoTargetConstants(accessToken, developerToken, audience.locations);
  return {
    campaign: { geoTargetConstants, languageConstant: "languageConstants/1000" /* English */ },
    adGroup: {
      ageRanges: ageRangeBuckets(audience.ageMin, audience.ageMax),
      genders: GENDER_TYPES[audience.gender],
      keywords: audience.interests,
    },
  };
}

const BROAD_DEFAULT_TARGETING: GoogleTargeting = {
  campaign: { geoTargetConstants: [`geoTargetConstants/${DEFAULT_GEO_TARGET_ID}`], languageConstant: "languageConstants/1000" },
  adGroup: { ageRanges: ageRangeBuckets(18, 65), genders: GENDER_TYPES.all, keywords: [] },
};

/**
 * Same bridge as metaTargetingMapper.resolveAudienceTargetingForWorkspace: strategy-generated
 * variants carry a free-text audienceName not structurally linked to a SavedAudience. Best
 * effort match by name, else a broad default (US, all ages/genders, no keyword restriction).
 */
export async function resolveGoogleTargetingForWorkspace(
  workspaceId: string,
  audienceName: string | undefined,
  accessToken: string | null,
  developerToken: string | null
): Promise<GoogleTargeting> {
  if (audienceName) {
    const audiences = await listSavedAudiences(workspaceId);
    const match = audiences.find((a) => a.name.toLowerCase() === audienceName.toLowerCase());
    if (match) return buildGoogleTargeting(accessToken, developerToken, match);
    logger.info(`No SavedAudience matches strategy audience "${audienceName}" — using broad default Google targeting`);
  }
  return BROAD_DEFAULT_TARGETING;
}
