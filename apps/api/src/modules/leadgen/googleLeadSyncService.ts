import { logger } from "../logger/logger.js";
import { getGoogleAdsCredentials } from "../integrations/googleOAuth.js";
import { ingestLead, upsertLeadForm } from "./leadIngestionService.js";

const GOOGLE_ADS_API_VERSION = "v24";

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delay = 500): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (i === retries - 1) throw new Error(`Google Ads API returned ${res.status}: ${await res.text()}`);
    } catch (err) {
      if (i === retries - 1) throw err;
    }
    await new Promise((r) => setTimeout(r, delay * (i + 1)));
  }
  throw new Error("unreachable");
}

async function gaqlSearch(customerId: string, accessToken: string, developerToken: string, query: string): Promise<any[]> {
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:search`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as any;
  return json.results ?? [];
}

/** Extracts LEAD_FORM assets (headline/business_name/CTA/fields) and upserts them as LeadForm rows. */
export async function syncGoogleLeadForms(workspaceId: string): Promise<number> {
  const credentials = await getGoogleAdsCredentials(workspaceId);
  if (!credentials) {
    logger.warn(`syncGoogleLeadForms: workspace ${workspaceId} has no connected Google Ads credentials`);
    return 0;
  }

  const query = `
    SELECT asset.id, asset.name, asset.lead_form_asset.headline, asset.lead_form_asset.business_name,
           asset.lead_form_asset.call_to_action_type, asset.lead_form_asset.fields
    FROM asset
    WHERE asset.type = 'LEAD_FORM'
  `;
  const results = await gaqlSearch(credentials.customerId, credentials.accessToken, credentials.developerToken, query);

  for (const r of results) {
    const asset = r.asset ?? {};
    const leadForm = asset.leadFormAsset ?? {};
    await upsertLeadForm({
      workspaceId,
      platform: "google",
      externalId: String(asset.id),
      name: asset.name ?? leadForm.businessName ?? `Lead Form ${asset.id}`,
      data: {
        headline: leadForm.headline,
        business_name: leadForm.businessName,
        call_to_action_type: leadForm.callToActionType,
        fields: (leadForm.fields ?? []).map((f: any) => f.inputType ?? f),
      },
    });
  }

  return results.length;
}

/** Extracts lead_form_submission_data rows and upserts them as Lead rows, incremental since `sinceIso` if given. */
export async function syncGoogleLeadSubmissions(workspaceId: string, sinceIso?: string): Promise<number> {
  const credentials = await getGoogleAdsCredentials(workspaceId);
  if (!credentials) {
    logger.warn(`syncGoogleLeadSubmissions: workspace ${workspaceId} has no connected Google Ads credentials`);
    return 0;
  }

  const dateFilter = sinceIso
    ? `WHERE lead_form_submission_data.submission_date_time >= '${sinceIso}'`
    : `WHERE lead_form_submission_data.submission_date_time DURING LAST_30_DAYS`;

  const query = `
    SELECT lead_form_submission_data.resource_name, lead_form_submission_data.asset_id,
           lead_form_submission_data.campaign, lead_form_submission_data.ad_group,
           lead_form_submission_data.submission_date_time, lead_form_submission_data.lead_form_submission_fields
    FROM lead_form_submission_data
    ${dateFilter}
  `;
  const results = await gaqlSearch(credentials.customerId, credentials.accessToken, credentials.developerToken, query);

  for (const r of results) {
    const submission = r.leadFormSubmissionData ?? {};
    const fieldsArr: Array<{ fieldType?: string; fieldValue?: string }> = submission.leadFormSubmissionFields ?? [];
    const fields: Record<string, string> = {};
    for (const f of fieldsArr) if (f.fieldType && f.fieldValue) fields[f.fieldType] = f.fieldValue;

    await ingestLead({
      workspaceId,
      platform: "google",
      externalId: String(submission.resourceName ?? `${submission.assetId}-${submission.submissionDateTime}`),
      formExternalId: submission.assetId ? String(submission.assetId) : null,
      campaignId: submission.campaign ?? null,
      fullName: fields.FULL_NAME ?? fields.FIRST_NAME ?? null,
      email: fields.EMAIL ?? null,
      phone: fields.PHONE_NUMBER ?? null,
      companyName: fields.COMPANY_NAME ?? null,
      submittedAt: submission.submissionDateTime ? new Date(submission.submissionDateTime) : new Date(),
      data: fields,
    });
  }

  return results.length;
}
