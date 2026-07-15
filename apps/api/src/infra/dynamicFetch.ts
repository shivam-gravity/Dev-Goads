/**
 * Passed as the explicit `fetch` option to every OpenAI-SDK-backed client in this codebase
 * (groqClient.ts, ollamaClient.ts) instead of letting the SDK default to
 * `Shims.getDefaultFetch()`. The SDK snapshots whatever `fetch` it's given ONCE, at client
 * construction time (`this.fetch = options.fetch ?? Shims.getDefaultFetch()`), never
 * re-reading it — so a test that reassigns `global.fetch` to a mock AFTER this module's
 * `OpenAI(...)` client was already constructed has no effect on it. In this repo's test
 * suite, ~90 files run in one shared process, so "already constructed" usually means
 * "constructed by some earlier, unrelated test file" rather than the test's own code —
 * this silently defeated fetch mocks in newAgents.test.ts/newResearchProviders.test.ts
 * (fixed there via import-order tricks) and crawlerProviders.test.ts (flaky "success" vs
 * "partial" results depending on real Groq/Mistral/Gemini quota state at the moment a
 * leaked, un-mocked real network call landed).
 *
 * This wrapper re-reads `globalThis.fetch` on every single call instead of once, so any
 * mock installed by any test, at any point, in any file order, is always honored — no
 * test file needs to change, and no import-order trick is needed either.
 */
export const dynamicFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = (input, init) =>
  globalThis.fetch(input, init);
