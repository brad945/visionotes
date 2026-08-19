/**
 * errors.js — pure helpers for classifying an error into an HTTP status and a
 * message that is safe to hand back to a client.
 *
 * WHY THIS IS A SEPARATE MODULE
 * -----------------------------
 * index.js boots a real server and needs live Supabase credentials, so nothing
 * in it can be unit tested. These two decisions — "is this a missing table?" and
 * "what status does this error actually deserve?" — are exactly the ones that
 * fail silently and stay broken, so they are pulled out here where `node --test`
 * can pin them down without a database.
 */

// "relation does not exist", in BOTH representations this API can receive:
//
//   PGRST205 — what Supabase/PostgREST (12+) actually returns. PostgREST answers
//              from its own schema cache, so the request never reaches Postgres
//              and the raw SQLSTATE never appears. Verified against the live
//              project: POST to the (unmigrated) landmark_frames table returns
//              {"code":"PGRST205","message":"Could not find the table
//              'public.landmark_frames' in the schema cache"}.
//   42P01    — the raw Postgres SQLSTATE, which is what a direct connection or
//              an older PostgREST reports.
//
// This used to be a single `error.code === "42P01"` comparison, which meant the
// check was DEAD against the real backend: replay uploads returned a generic 500
// instead of the designed 501, and replay reads 500'd instead of returning an
// empty list. Matching the family rather than one constant is the point — a
// second representation is exactly how this broke the first time.
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

export function isMissingTableError(error) {
  return typeof error?.code === "string" && MISSING_TABLE_CODES.has(error.code);
}

// Body-parser and http-errors both set `err.type`; it is more specific than the
// status and gives the user something actionable instead of "Bad request".
const TYPE_MESSAGES = {
  "entity.parse.failed": "Malformed JSON body",
  "entity.too.large": "Request body too large",
  "entity.verify.failed": "Malformed request body",
  "encoding.unsupported": "Unsupported content encoding",
  "request.aborted": "Request aborted",
  "request.size.invalid": "Invalid request size",
  "parameters.too.many": "Too many parameters",
  "charset.unsupported": "Unsupported charset",
};

/**
 * The status an error already carries, or 500.
 *
 * Express's DEFAULT error handler honours `err.status`; a custom one does not
 * unless it says so. Adding a JSON error handler without this line silently
 * converted every framework-generated 4xx into a 500 — malformed JSON came back
 * as "Internal server error", telling the client to retry something that can
 * never succeed.
 */
export function httpStatusFromError(err) {
  const status = err?.status ?? err?.statusCode;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

/**
 * A message safe to send to a client: never raw driver/Postgres text (it leaks
 * column names, constraint names and schema shape), but specific enough for a
 * 4xx to be actionable, since a 4xx is the client's to fix.
 */
export function publicErrorMessage(err, status = httpStatusFromError(err)) {
  const byType = TYPE_MESSAGES[err?.type];
  if (byType) return byType;
  if (status >= 400 && status < 500) return "Bad request";
  return "Internal server error";
}
