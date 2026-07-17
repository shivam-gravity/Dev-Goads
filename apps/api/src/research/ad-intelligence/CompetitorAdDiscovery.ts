import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../modules/logger/logger.js";
import { fetchGoogleTransparencyAdsForQuery, fetchMetaAdsForQuery, type RawAdEntry } from "./adSourceClients.js";

export interface CompetitorAdDiscoveryResult {
  competitorId: string;
  adsSeen: number;
  adsDeactivated: number;
  attempted: boolean;
}

/**
 * Discovers a competitor's current running/inactive ads (Meta + Google — the same clients
 * AdLibraryProvider uses for the business's OWN ads, parameterized here per-competitor) and
 * upserts CompetitorAd rows keyed by (competitorId, platform, externalAdId). firstSeenAt is
 * set only on insert; lastSeenAt/isActive refresh on every pass so an ad that stops
 * appearing is marked inactive (not deleted) — its observation history stays intact.
 *
 * Deactivation only runs when at least one source genuinely queried successfully this pass
 * (`attempted`) — a run where both sources failed/were unconfigured must never be read as
 * "this competitor now has zero ads," which would wrongly flip every previously-seen ad to
 * inactive on a transient outage or a missing META_AD_LIBRARY_ACCESS_TOKEN.
 */
export async function discoverCompetitorAds(competitorId: string, query: string): Promise<CompetitorAdDiscoveryResult> {
  const [metaResult, googleResult] = await Promise.all([
    fetchMetaAdsForQuery(query).catch(() => ({ ads: [] as RawAdEntry[], attempted: false })),
    fetchGoogleTransparencyAdsForQuery(query).catch(() => ({ ads: [] as RawAdEntry[], attempted: false, source: null })),
  ]);

  const attempted = metaResult.attempted || googleResult.attempted;
  const ads = [...metaResult.ads, ...googleResult.ads];
  const now = new Date();
  const seenKeys = new Set<string>();

  for (const ad of ads) {
    seenKeys.add(`${ad.platform}:${ad.externalAdId}`);
    try {
      await prisma.competitorAd.upsert({
        where: { competitorId_platform_externalAdId: { competitorId, platform: ad.platform, externalAdId: ad.externalAdId } },
        create: {
          id: randomUUID(),
          competitorId,
          platform: ad.platform,
          externalAdId: ad.externalAdId,
          headline: ad.headline ?? null,
          description: ad.bodyText ?? null,
          landingPageUrl: ad.sourceUrl,
          estimatedCountries: [],
          rawSourceData: ad as any,
          firstSeenAt: now,
          lastSeenAt: now,
          isActive: true,
        },
        update: {
          headline: ad.headline ?? undefined,
          description: ad.bodyText ?? undefined,
          lastSeenAt: now,
          isActive: true,
          rawSourceData: ad as any,
        },
      });
    } catch (err) {
      logger.warn(`discoverCompetitorAds: failed to upsert ad ${ad.platform}:${ad.externalAdId} for competitor ${competitorId}`, err);
    }
  }

  let adsDeactivated = 0;
  if (attempted) {
    const existing = await prisma.competitorAd.findMany({
      where: { competitorId, isActive: true },
      select: { id: true, platform: true, externalAdId: true },
    });
    const toDeactivate = existing.filter((row) => !seenKeys.has(`${row.platform}:${row.externalAdId}`));
    if (toDeactivate.length > 0) {
      await prisma.competitorAd.updateMany({ where: { id: { in: toDeactivate.map((r) => r.id) } }, data: { isActive: false } });
      adsDeactivated = toDeactivate.length;
    }
  }

  await prisma.competitor.update({ where: { id: competitorId }, data: { lastEnrichedAt: now } }).catch(() => {});

  return { competitorId, adsSeen: ads.length, adsDeactivated, attempted };
}
