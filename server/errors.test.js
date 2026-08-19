// errors.test.js — node:test suite for the error-classification helpers.
// ---------------------------------------------------------------------------
// Two bugs live here, and both were invisible to the obvious test:
//
//   1. The missing-table check compared against ONE Postgres code (42P01) while
//      the live Supabase project returns PGRST205. A mock that hands back the
//      same constant the code already checks confirms the constant, not the
//      behaviour — so every case below asserts BOTH representations map to the
//      SAME outcome. If a future refactor narrows the check again, the second
//      assertion is the one that fails.
//   2. The JSON error handler dropped `err.status`, turning framework 4xx into
//      500s. A 500 tells a client to retry; a 400 tells it not to.
//
// No server, no database: these are pure functions on purpose.
// Run:  npm test   (in server/)
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";
import { isMissingTableError, httpStatusFromError, publicErrorMessage } from "./errors.js";

test("missing table: PostgREST schema-cache form (what the live project returns)", () => {
  assert.equal(
    isMissingTableError({
      code: "PGRST205",
      message: "Could not find the table 'public.landmark_frames' in the schema cache",
    }),
    true
  );
});

test("missing table: raw Postgres SQLSTATE form (direct connection / older PostgREST)", () => {
  assert.equal(
    isMissingTableError({ code: "42P01", message: 'relation "landmark_frames" does not exist' }),
    true
  );
});

test("missing table: both representations agree, so neither can be dropped silently", () => {
  const outcomes = ["PGRST205", "42P01"].map((code) => isMissingTableError({ code }));
  assert.deepEqual(outcomes, [true, true]);
});

test("missing table: unrelated database errors are NOT swallowed as 'no table'", () => {
  // These must keep reaching the generic 500 path — treating a permission error
  // or a constraint violation as "no replay stored" would hide a real outage.
  for (const code of ["PGRST116", "23505", "42501", "PGRST301", "", undefined, null]) {
    assert.equal(isMissingTableError({ code }), false, `code ${String(code)} must not match`);
  }
  assert.equal(isMissingTableError(null), false);
  assert.equal(isMissingTableError(undefined), false);
  assert.equal(isMissingTableError({}), false);
});

test("status: an error's own status is honoured, not flattened to 500", () => {
  // body-parser's real shapes.
  assert.equal(httpStatusFromError({ type: "entity.parse.failed", status: 400 }), 400);
  assert.equal(httpStatusFromError({ type: "entity.too.large", status: 413 }), 413);
  assert.equal(httpStatusFromError({ type: "encoding.unsupported", status: 415 }), 415);
  // Some libraries set statusCode instead of status.
  assert.equal(httpStatusFromError({ statusCode: 404 }), 404);
});

test("status: anything without a usable status is a 500", () => {
  assert.equal(httpStatusFromError(new Error("boom")), 500);
  assert.equal(httpStatusFromError({ status: 200 }), 500); // a "success" on the error path is a bug, not a 200
  assert.equal(httpStatusFromError({ status: 999 }), 500);
  assert.equal(httpStatusFromError({ status: "400" }), 500); // strings are not statuses
  assert.equal(httpStatusFromError(null), 500);
});

test("message: a 4xx says what the client got wrong; a 5xx says nothing", () => {
  assert.equal(publicErrorMessage({ type: "entity.parse.failed", status: 400 }), "Malformed JSON body");
  assert.equal(publicErrorMessage({ type: "entity.too.large", status: 413 }), "Request body too large");
  assert.equal(publicErrorMessage({ type: "encoding.unsupported", status: 415 }), "Unsupported content encoding");
  assert.equal(publicErrorMessage({ status: 400 }), "Bad request");
  assert.equal(publicErrorMessage(new Error("relation \"sessions\" does not exist")), "Internal server error");
});

test("message: never leaks the underlying error text", () => {
  const leaky = new Error('column "user_id" of relation "sessions" violates not-null constraint');
  assert.ok(!publicErrorMessage(leaky).includes("user_id"));
});
