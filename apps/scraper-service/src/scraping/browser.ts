import { chromium, type Browser, type Page } from "playwright";

// Launching Chromium takes ~1s — reused across requests instead of per-request.
// Each call still gets an isolated context so pages/cookies never leak between requests.
let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

// Caps how many pages run concurrently against the one shared Chromium instance. Without
// this, a burst of parallel research providers (each research/campaign-generation run can
// fire ~7 of them at once, times the worker's own job concurrency) could pile onto the
// single browser process simultaneously and exhaust its memory/CPU. Callers beyond the cap
// simply await their turn in FIFO order rather than piling on — apps/api's own
// INHOUSE_ATTEMPT_TIMEOUT_MS sub-deadline (scrapeFallback.ts) bounds how long that wait can
// plausibly matter to any one caller.
const MAX_CONCURRENT_PAGES = Number(process.env.SCRAPER_MAX_CONCURRENT_PAGES ?? 4);
let activePages = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activePages += 1;
}

function releaseSlot(): void {
  activePages -= 1;
  const next = waiters.shift();
  if (next) next();
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (compatible; PolluxaProductBot/1.0)",
    });
    try {
      const page = await context.newPage();
      return await fn(page);
    } finally {
      await context.close();
    }
  } finally {
    releaseSlot();
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise;
  await browser.close();
  browserPromise = null;
}
