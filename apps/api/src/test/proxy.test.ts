import { test } from "node:test";
import assert from "node:assert";
import { proxyTo } from "../gateway/proxy.js";

function fakeReqRes(method: string) {
  const req = { method, path: "/test", url: "/test", headers: {}, body: {} } as any;
  const res: any = {
    statusCode: 0,
    body: undefined as string | unknown,
    setHeader() {},
    status(code: number) { this.statusCode = code; return this; },
    send(body: string) { this.body = body; },
    json(body: unknown) { this.body = body; },
  };
  return { req, res };
}

test("proxyTo - a GET request that hits a 503 retries and succeeds on the next attempt", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const { req, res } = fakeReqRes("GET");
    await proxyTo("http://fake-upstream")(req, res, () => {});
    assert.strictEqual(calls, 2, "should retry once after a 503");
    assert.strictEqual(res.statusCode, 200);
  } finally {
    global.fetch = original;
  }
});

test("proxyTo - a POST request that hits a 503 does NOT retry (non-idempotent)", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    return new Response("unavailable", { status: 503 });
  }) as typeof fetch;

  try {
    const { req, res } = fakeReqRes("POST");
    await proxyTo("http://fake-upstream")(req, res, () => {});
    assert.strictEqual(calls, 1, "a POST must never be retried automatically");
    assert.strictEqual(res.statusCode, 503);
  } finally {
    global.fetch = original;
  }
});

test("proxyTo - a GET request that always fails exhausts retries and returns 502", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    throw new Error("network down");
  }) as typeof fetch;

  try {
    const { req, res } = fakeReqRes("GET");
    await proxyTo("http://fake-upstream")(req, res, () => {});
    assert.strictEqual(calls, 3, "should attempt 1 + 2 retries before giving up");
    assert.strictEqual(res.statusCode, 502);
  } finally {
    global.fetch = original;
  }
});

test("proxyTo - a POST request that fails once returns 502 immediately, without retrying", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    throw new Error("network down");
  }) as typeof fetch;

  try {
    const { req, res } = fakeReqRes("POST");
    await proxyTo("http://fake-upstream")(req, res, () => {});
    assert.strictEqual(calls, 1);
    assert.strictEqual(res.statusCode, 502);
  } finally {
    global.fetch = original;
  }
});

test("proxyTo - a GET request that succeeds on the first try makes exactly one call", async () => {
  const original = global.fetch;
  let calls = 0;
  global.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const { req, res } = fakeReqRes("GET");
    await proxyTo("http://fake-upstream")(req, res, () => {});
    assert.strictEqual(calls, 1);
    assert.strictEqual(res.statusCode, 200);
  } finally {
    global.fetch = original;
  }
});
