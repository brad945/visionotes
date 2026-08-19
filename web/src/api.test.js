// api.test.js — vitest suite for the fetch wrapper's error handling.
// ---------------------------------------------------------------------------
// The bug this suite exists for: every function used to do
//   `if (!res.ok) throw new Error((await res.json()).error)`
// which assumes the error body is JSON. A 413 from a proxy, an HTML gateway
// page, or an empty body made res.json() itself throw, and that SyntaxError
// replaced the real status — the user saw "Unexpected token '<'" instead of
// "too large". So: every non-JSON error shape, plus the status being preserved.
//
// Run:  npm test   (vitest run)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The real client needs Supabase env vars at import time; the token is
// irrelevant to what's under test here. It is a vi.fn so one test can make the
// auth lookup FAIL — see "a failure before the request is not a network error".
const { getSupabaseSession } = vi.hoisted(() => ({ getSupabaseSession: vi.fn() }));
vi.mock("./supabaseClient", () => ({
  supabase: { auth: { getSession: getSupabaseSession } },
}));

const {
  ApiError, REQUEST_TIMEOUT_MS,
  postLandmarks, postFaults, listSessions, getSession, deleteSession, startSession,
} = await import("./api.js");

// Minimal Response stand-in: apiFetch only uses ok/status/statusText/text().
function response(status, body, { statusText = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => body,
  };
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
  getSupabaseSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// An abort rejection shaped like the one fetch/undici actually throws.
function abortError() {
  const e = new Error("This operation was aborted");
  e.name = "AbortError";
  return e;
}

describe("error responses", () => {
  it("uses the server's JSON error message and keeps the status", async () => {
    fetch.mockResolvedValue(response(404, JSON.stringify({ error: "Session not found" })));

    const err = await listSessions().catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Session not found");
    expect(err.status).toBe(404);
  });

  it("does not mask a 413 whose body is not JSON", async () => {
    // nginx/Cloudflare-style HTML 413 — the exact case that used to surface as a
    // JSON parse error with no status attached.
    fetch.mockResolvedValue(response(413, "<html><body><h1>413 Request Entity Too Large</h1></body></html>"));

    const err = await postLandmarks("session-id", [{ t: 0 }]).catch((e) => e);

    expect(err.status).toBe(413);
    expect(err.message).toMatch(/too large/i);
    expect(err.message).not.toMatch(/JSON|token/i);
  });

  it("does not mask a 502 HTML gateway page", async () => {
    fetch.mockResolvedValue(response(502, "<html>502 Bad Gateway</html>", { statusText: "Bad Gateway" }));

    const err = await getSession("session-id").catch((e) => e);

    expect(err.status).toBe(502);
    expect(err.message).toMatch(/502/);
  });

  it("handles an empty error body", async () => {
    fetch.mockResolvedValue(response(500, ""));

    const err = await deleteSession("session-id").catch((e) => e);

    expect(err.status).toBe(500);
    expect(err.message).toMatch(/Request failed \(500/);
  });

  it("reports a network-level failure as status 0", async () => {
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const err = await listSessions().catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/reach the server/i);
  });
});

describe("a request that never finishes", () => {
  // The failure this guards against is worse than an error: an unsettled promise.
  // saveSession awaits the replay flush, so a hung socket left `saving` true
  // forever — Start disabled, no banner, nothing on screen to explain it.
  it("gives up on a server that accepts the connection and never answers", async () => {
    vi.useFakeTimers();
    fetch.mockImplementation((url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(abortError()));
    }));

    const pending = listSessions().catch((e) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    const err = await pending;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/took longer/i);
  });

  it("gives up on a server that sends headers and then stalls the body", async () => {
    // The subtle half: fetch() RESOLVES as soon as headers arrive, so a timeout
    // cleared right after the fetch call would leave res.text() hanging forever.
    vi.useFakeTimers();
    fetch.mockImplementation(async (url, init) => ({
      ok: true,
      status: 200,
      statusText: "",
      text: () => new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(abortError()));
      }),
    }));

    const pending = listSessions().catch((e) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    const err = await pending;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/took longer/i);
  });

  it("does not leave a timer armed after a request completes", async () => {
    vi.useFakeTimers();
    fetch.mockResolvedValue(response(200, "{}"));

    await listSessions();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("failures before the request leaves the browser", () => {
  // These used to be reported as "Could not reach the server", which is the same
  // class of masking this module was rewritten to remove: the server was fine.
  it("does not report a broken auth lookup as an unreachable server", async () => {
    getSupabaseSession.mockRejectedValue(new Error("localStorage is not available"));

    const err = await listSessions().catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/localStorage is not available/);
    expect(err.message).not.toMatch(/reach the server/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not report an unserialisable body as an unreachable server", async () => {
    const circular = { t: 0 };
    circular.self = circular;

    const err = await postLandmarks("session-id", [circular]).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toMatch(/prepare the request/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("success responses", () => {
  it("parses a JSON body", async () => {
    fetch.mockResolvedValue(response(201, JSON.stringify({ session_id: "abc" })));
    await expect(startSession()).resolves.toEqual({ session_id: "abc" });
  });

  it("returns null for an empty 204 body instead of throwing", async () => {
    fetch.mockResolvedValue(response(204, ""));
    await expect(deleteSession("session-id")).resolves.toBeNull();
  });

  it("sends the auth header and the JSON content type", async () => {
    fetch.mockResolvedValue(response(200, "{}"));
    await listSessions();

    const [, init] = fetch.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });
});

describe("request shapes", () => {
  it("sends frames with their chunk index", async () => {
    fetch.mockResolvedValue(response(201, JSON.stringify({ stored: 2, chunk_index: 3 })));

    await postLandmarks("session-id", [{ t: 0 }, { t: 160 }], 3);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/sessions\/session-id\/landmarks$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ frames: [{ t: 0 }, { t: 160 }], chunk_index: 3 });
  });

  it("defaults the chunk index to 0", async () => {
    fetch.mockResolvedValue(response(201, "{}"));
    await postLandmarks("session-id", [{ t: 0 }]);
    expect(JSON.parse(fetch.mock.calls[0][1].body).chunk_index).toBe(0);
  });

  it("skips the request entirely when there is nothing to send", async () => {
    await expect(postLandmarks("session-id", [])).resolves.toBeUndefined();
    await expect(postFaults("session-id", [])).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats a missing list as nothing to send, not as a crash", async () => {
    // postFaults(id, undefined) used to throw a raw TypeError — the one error in
    // this module that was not an ApiError, so callers' error handling missed it.
    await expect(postFaults("session-id", undefined)).resolves.toBeUndefined();
    await expect(postLandmarks("session-id", undefined)).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
