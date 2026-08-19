/**
 * saveSession — the end-of-session write path, as a pure function.
 *
 * WHY IT IS NOT INLINE IN Practice.jsx ANYMORE
 * --------------------------------------------
 * It used to be `Promise.all([endSession, postFaults, postLandmarks])` inside a
 * try/catch that only console.error'd. Three problems, all of which this shape
 * fixes:
 *
 *  1. Promise.all fires all three at once. Whichever ones succeed still land, so
 *     a single rejection leaves a half-written session and no way to know which
 *     half — there is no repair path. Here the steps run in order and the caller
 *     gets back the exact step that failed plus a `progress` record, so a Retry
 *     resumes from where it stopped instead of re-running work that landed
 *     (re-running postFaults would duplicate every fault row).
 *  2. The user was told nothing. This returns a result object the UI renders.
 *  3. All three were treated as equally critical. They are not:
 *
 *     CRITICAL   postFaults, endSession — the session's actual data.
 *     BEST-EFFORT landmarks — a replay nicety. The landmark_frames table may not
 *                even exist yet (migration 002 is unapplied), and a missing
 *                replay must never present as "your practice wasn't saved".
 *
 * Step order is postFaults → endSession, because PATCH /sessions/:id derives
 * total_faults by counting fault_events. Faults first means the count is right
 * the first time. It also fails more legibly: faults-fail-then-not-ended leaves
 * an obviously unfinished session, whereas ending first would leave a closed
 * session displaying a plausible-looking `total_faults: 0`. Silently wrong data
 * is worse than visibly incomplete data.
 */

/**
 * Fault events are posted in batches of this size instead of one request.
 *
 * WHY (measured, not assumed): the server rejects a batch over 5000 events with
 * a 400 — a wall that Retry can never clear, so hitting it loses the whole
 * session's fault data. Typical practice runs ~0.3–0.6 events/sec, which would
 * never reach it; but a real recorded session in this project's own database
 * logged 441 DISTINCT events in 18 seconds (24.5/sec) when posture sat right on
 * the detection threshold and the smoother chattered. At that rate the cap
 * arrives after ~3.4 minutes of practice.
 *
 * That is the same "the payload grows with session length" bug the replay
 * uploader was rewritten to remove, still present on the CRITICAL path. Same
 * fix, same reason: constant request size, growing request count.
 *
 * 1000 is deliberately well under the server's 5000 so the server's cap stays
 * the boundary and this stays a throughput choice (identical to the
 * CHUNK_FRAMES / MAX_FRAMES_PER_CHUNK split on the replay path).
 */
export const FAULT_BATCH_SIZE = 1000;

/**
 * @param {object} session       { id, durationSeconds, events }
 * @param {object} deps          { postFaults, endSession, flushLandmarks }
 *        flushLandmarks() must resolve (never reject) to the uploader's
 *        flush result: { error, disabledReason, pendingFrames, droppedFrames }.
 * @param {object} progress      Work already completed by an earlier attempt:
 *        { faultsSentThrough, sessionEnded }.
 * @returns {Promise<{ok, progress, failedStep, error, replayWarning}>}
 */
export async function saveSession(
  { id, durationSeconds, events },
  { postFaults, endSession, flushLandmarks },
  progress = {}
) {
  const all = events ?? [];
  const done = { faultsSentThrough: 0, sessionEnded: false, ...progress };

  // `faultsSentThrough` is a COUNT, not a boolean, precisely because the faults
  // step is now several requests: a retry has to know which batches already
  // landed. Honest caveat — fault_events is a plain insert with no conflict key,
  // so this makes retry exact only for batches whose response we SAW. A batch
  // that was inserted but whose response was lost will duplicate on retry. That
  // is no worse than the single-request version had, and bounded to one batch.
  while (done.faultsSentThrough < all.length) {
    const batch = all.slice(done.faultsSentThrough, done.faultsSentThrough + FAULT_BATCH_SIZE);
    try {
      await postFaults(id, batch);
      done.faultsSentThrough += batch.length;
    } catch (error) {
      return { ok: false, progress: done, failedStep: "faults", error, replayWarning: null };
    }
  }

  if (!done.sessionEnded) {
    try {
      await endSession(id, durationSeconds, all.length);
      done.sessionEnded = true;
    } catch (error) {
      return { ok: false, progress: done, failedStep: "end", error, replayWarning: null };
    }
  }

  // Best-effort. A failure here is a warning on a saved session, not a failure.
  let replayWarning = null;
  try {
    const result = await flushLandmarks();
    if (result?.error || result?.disabledReason || result?.droppedFrames > 0) {
      replayWarning = replayWarningMessage(result);
    }
  } catch (e) {
    // flushLandmarks is contractually non-throwing; belt and braces so a bug in
    // the replay path can never lose an otherwise-saved session.
    replayWarning = replayWarningMessage({ error: e });
  }

  return { ok: true, progress: done, failedStep: null, error: null, replayWarning };
}

function replayWarningMessage(result) {
  // Frames dropped at the buffer ceiling are a DIFFERENT outcome from a failed
  // upload: the session's replay exists but is incomplete. Saying "couldn't be
  // stored" there would be a lie, and silently storing a gappy replay was the
  // reviewer's fair complaint — the uploader counted drops and nothing ever
  // showed them.
  if (!result?.error && !result?.disabledReason && result?.droppedFrames > 0) {
    return `Session saved, but ${result.droppedFrames} skeleton replay frames were dropped — the replay will have a gap.`;
  }
  const detail = result?.error?.message || result?.disabledReason || "upload failed";
  return `Session saved, but the skeleton replay couldn't be stored (${detail}).`;
}

/** Human-facing text for a failed critical step. */
export function saveErrorMessage(failedStep, error) {
  const what =
    failedStep === "faults" ? "save this session's posture events" : "finish saving this session";
  return `Couldn't ${what}: ${error?.message || "unknown error"}`;
}
