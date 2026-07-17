export const dynamicFetch: typeof fetch = (...args: Parameters<typeof fetch>) => globalThis.fetch(...args);
