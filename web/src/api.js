/**
 * API client — wraps fetch calls to the backend with the user's Supabase JWT.
 *
 * Every call goes through `apiFetch`, which owns the two things that used to be
 * copy-pasted (and subtly wrong) in all eight functions: attaching auth headers,
 * and turning a non-2xx response into an error a human can read.
 */

import { supabase } from "./supabaseClient";

// 3002 matches server/.env.example and the server's own default. A default that
// disagrees with the documented port is a first-run failure for no reason.
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3002";

/**
 * Hard ceiling on how long ONE request may take before it is aborted.
 *
 * Without this, a hung socket (server accepted the connection and then stopped
 * responding — a stalled proxy, a laptop that slept mid-request) leaves the
 * promise permanently unsettled. That is worse than an error: the end-of-session
 * save awaits it forever, so `saving` never clears, no banner ever renders, and
 * the Start button stays disabled with nothing on screen explaining why. A
 * failure the user can see and retry beats a silent hang every time.
 *
 * 20s is deliberately generous — every request this client makes is bounded now
 * (replay chunks of 300 frames, fault batches under FAULT_BATCH_SIZE), so a
 * legitimate request that takes longer than this is not slow, it is stuck.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Error thrown by every function in this module on a failed request.
 * `status` is the HTTP status (0 = the request never reached a server), which
 * lets callers distinguish "retry might work" from "this will never work".
 */
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// Fallbacks for statuses where the body is often NOT our JSON — a proxy 413, a
// gateway 502 HTML page, an empty 500. Our own server always returns
// { error }, but nothing between the browser and it promises to.
const STATUS_FALLBACK = {
  0: "Could not reach the server. Check your connection and that the API is running.",
  401: "Your session expired. Sign in again.",
  404: "Not found.",
  413: "That request was too large for the server to accept.",
  429: "Too many requests — slow down for a moment.",
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Perform an authenticated request and return the parsed JSON body (or null for
 * an empty body, e.g. a 204).
 *
 * The old code did `throw new Error((await res.json()).error)` on !res.ok. When
 * the body was NOT json — a 413 from a proxy, an HTML error page, an empty
 * response — res.json() itself threw, and the thrown SyntaxError replaced the
 * real status. The user saw "Unexpected token '<'" instead of "too large".
 * So: read the body as text once, parse it opportunistically, and always keep
 * the status.
 */
async function apiFetch(path, { method = "GET", body } = {}) {
  // Building the request happens OUTSIDE the network try/catch on purpose.
  // Reading the Supabase session and serialising the body can both fail
  // (auth storage unavailable, a circular structure in the payload) and neither
  // is a network problem — reporting them as "Could not reach the server" is the
  // same class of masking this module was rewritten to remove.
  let init;
  try {
    init = {
      method,
      headers: await authHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
  } catch (e) {
    const err = new ApiError(
      `Couldn't prepare the request (${e?.message || "unknown error"}).`,
      0,
      null
    );
    err.cause = e;
    throw err;
  }

  // One controller for the WHOLE exchange, including the body read. fetch()
  // resolves as soon as the response headers arrive, so a server that sends
  // headers and then stalls hangs in res.text(), not in fetch — a timeout that
  // is cleared right after the fetch call would miss exactly that case.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  let text;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    text = await res.text();
  } catch (e) {
    // fetch only rejects for network-level failures (server down, DNS, CORS
    // preflight refused) or our own abort. Status 0 is the conventional marker
    // for "no response"; the original error is kept as `cause` for debugging.
    const timedOut = e?.name === "AbortError";
    const err = new ApiError(
      timedOut
        ? `The server took longer than ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s to respond. It may be down or overloaded.`
        : STATUS_FALLBACK[0],
      0,
      null
    );
    err.cause = e;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null; // not JSON — keep the raw text as the error body
    }
  }

  if (!res.ok) {
    const message =
      parsed?.error ||
      STATUS_FALLBACK[res.status] ||
      `Request failed (${res.status}${res.statusText ? ` ${res.statusText}` : ""})`;
    throw new ApiError(message, res.status, parsed ?? text ?? null);
  }

  return parsed;
}

export async function startSession(cameraMode = "side") {
  return apiFetch("/sessions", {
    method: "POST",
    body: { camera_mode: cameraMode },
  }); // { session_id }
}

export async function endSession(sessionId, durationSeconds, totalFaults) {
  return apiFetch(`/sessions/${sessionId}`, {
    method: "PATCH",
    body: {
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
      total_faults: totalFaults,
    },
  });
}

export async function postFaults(sessionId, faults) {
  // Optional-chained: a caller with nothing to send should be a no-op, not a
  // raw TypeError that escapes this module's ApiError contract.
  if (!faults?.length) return;
  return apiFetch(`/sessions/${sessionId}/faults`, {
    method: "POST",
    body: { faults },
  });
}

export async function listSessions() {
  return apiFetch("/sessions");
}

export async function getSession(sessionId) {
  return apiFetch(`/sessions/${sessionId}`);
}

/**
 * Upload ONE chunk of skeleton replay frames.
 *
 * `chunkIndex` is the position of this chunk in the session's frame stream. The
 * server upserts on (session_id, chunk_index), so re-posting the same index is
 * idempotent — a retry after a timeout can never duplicate or interleave frames.
 */
export async function postLandmarks(sessionId, frames, chunkIndex = 0) {
  if (!frames?.length) return;
  return apiFetch(`/sessions/${sessionId}/landmarks`, {
    method: "POST",
    body: { frames, chunk_index: chunkIndex },
  }); // { stored: N, chunk_index }
}

export async function getLandmarks(sessionId) {
  return apiFetch(`/sessions/${sessionId}/landmarks`); // { frames: [...] }
}

export async function deleteSession(sessionId) {
  return apiFetch(`/sessions/${sessionId}`, { method: "DELETE" }); // { deleted: id }
}
