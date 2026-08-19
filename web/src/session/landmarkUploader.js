/**
 * landmarkUploader — turns an unbounded stream of skeleton replay frames into a
 * sequence of bounded, idempotent HTTP uploads.
 *
 * WHY THIS EXISTS
 * ---------------
 * useVision samples ~6 skeleton frames/sec at ~830 bytes each. Posting the whole
 * session in one request at Stop makes the request size grow with session
 * length: 20s crosses Express's 100kb default, 2 min is ~608KB, 30 min is ~9MB.
 * Raising the body limit only moves the cliff — it does not remove it, because
 * there is no session length the limit is guaranteed to cover.
 *
 * Chunking inverts that: request SIZE is constant (CHUNK_FRAMES) and request
 * COUNT grows with session length, which is the direction HTTP, proxies and
 * body limits are all built to scale. Flushing DURING the session (rather than
 * only at Stop) additionally means a crash, refresh or closed tab loses at most
 * one partial chunk instead of the entire replay.
 *
 * Design contracts worth knowing:
 *  - The chunk index only advances AFTER a successful post. If it advanced
 *    first, a failed chunk would leave a silent hole in the stored stream —
 *    the reader would concatenate chunks 0,2,3 and see missing frames with no
 *    error anywhere. A failed chunk stays at the head of `pending` and is
 *    retried, at the same index, on the next flush.
 *  - The server upserts on (session_id, chunk_index), so retrying a chunk that
 *    actually landed (e.g. the response was lost) overwrites rather than
 *    duplicates.
 *  - Flushes are serialized on a promise chain. Two overlapping flushes reading
 *    the same `pending` would post the same frames twice under two indices.
 *  - Replay is a NICE-TO-HAVE, never the critical path. `flush()` never throws;
 *    it reports failure in its return value. After MAX_FAILURES consecutive
 *    failures it disables itself and drops its buffer, so an unavailable
 *    endpoint (e.g. the landmark_frames migration was never applied) can neither
 *    grow memory without bound nor spam the API mid-practice.
 *
 * WHAT THIS DOES *NOT* CLAIM
 * --------------------------
 * It is not lossless, and the honest version of the argument matters: giving up
 * after MAX_FAILURES, and dropping frames at MAX_PENDING_FRAMES, both discard
 * replay data. The difference from "buffer everything and post once at Stop" is
 * not that this never loses frames — it is that the loss is BOUNDED, happens
 * only after repeated failures or a stalled uploader, and is REPORTED (see
 * `droppedFrames` and `disabledReason`, both surfaced in the flush result and
 * turned into a user-visible note by saveSession). Silent loss was the thing
 * worth removing, not loss.
 */

// ~48s of capture at 6fps, ~250KB of JSON. Deliberately well under the server's
// body limit AND under its MAX_FRAMES_PER_CHUNK — the client's chunk size is a
// throughput choice, the server's cap is the actual boundary.
export const CHUNK_FRAMES = 300;

// Consecutive failed posts before the uploader gives up for this session.
export const MAX_FAILURES = 3;

// Hard ceiling on buffered-but-unsent frames (~11 min of capture). Only reachable
// if flushes stop happening entirely; frames past it are dropped so a stuck
// uploader cannot eat the tab's memory during a long practice.
export const MAX_PENDING_FRAMES = 4000;

/**
 * @param {object} opts
 * @param {(frames: Array, chunkIndex: number) => Promise} opts.post
 *        Uploads one chunk. Must reject on failure.
 */
export function createLandmarkUploader({
  post,
  chunkFrames = CHUNK_FRAMES,
  maxFailures = MAX_FAILURES,
  maxPendingFrames = MAX_PENDING_FRAMES,
} = {}) {
  let pending = [];
  let nextIndex = 0;
  let failures = 0;
  let disabledReason = null;
  let droppedFrames = 0;
  // Serializes flushes. Every flush chains onto the previous one instead of
  // running concurrently against the same `pending` array.
  let chain = Promise.resolve();

  function push(frames) {
    // Already given up on this session's replay: `disabledReason` is the report,
    // and counting further drops would only inflate a number nobody reads.
    if (disabledReason || !frames?.length) return;
    for (const frame of frames) {
      // Drop the NEWEST arrivals when full rather than evicting the oldest.
      // Being precise about what this costs, because an earlier version of this
      // comment claimed more than the code delivers: the buffer DRAINS, so if
      // uploads later recover, the stored stream is "…everything up to the
      // ceiling, then a gap, then whatever came after" — a hole, not a clean
      // truncation. Evicting the oldest instead would put the hole at the start
      // and lose the part of the practice most likely to be reviewed, so this
      // stays; what changed is that `droppedFrames` is now reported to the user
      // instead of a gappy replay appearing complete.
      if (pending.length >= maxPendingFrames) {
        droppedFrames += 1;
        continue;
      }
      pending.push(frame);
    }
  }

  async function runFlush(final) {
    if (disabledReason) {
      return { uploadedChunks: 0, pendingFrames: 0, error: null, disabledReason, droppedFrames };
    }

    let uploadedChunks = 0;
    while (pending.length >= chunkFrames || (final && pending.length > 0)) {
      const chunk = pending.slice(0, chunkFrames);
      try {
        await post(chunk, nextIndex);
      } catch (error) {
        failures += 1;
        if (failures >= maxFailures) {
          disabledReason = error?.message || "Replay upload failed";
          pending = [];
        }
        // `pending` still starts with this chunk and `nextIndex` is unchanged,
        // so the next flush retries exactly the same frames at the same index.
        return { uploadedChunks, pendingFrames: pending.length, error, disabledReason, droppedFrames };
      }
      pending = pending.slice(chunk.length);
      nextIndex += 1;
      failures = 0;
      uploadedChunks += 1;
    }

    // droppedFrames rides along on every result: it is the only way a gap in the
    // stored replay reaches the user, and saveSession turns it into a note.
    return { uploadedChunks, pendingFrames: pending.length, error: null, disabledReason, droppedFrames };
  }

  /**
   * Upload every full chunk currently buffered. With `{ final: true }` a partial
   * chunk is uploaded too (used once, at session end).
   * Never throws — inspect `.error` / `.disabledReason` on the result.
   */
  function flush({ final = false } = {}) {
    const run = chain.then(() => runFlush(final));
    chain = run.then(
      () => undefined,
      () => undefined // keep the chain alive even if runFlush itself blows up
    );
    return run;
  }

  return {
    push,
    flush,
    get pendingFrames() {
      return pending.length;
    },
    get nextChunkIndex() {
      return nextIndex;
    },
    get disabledReason() {
      return disabledReason;
    },
    get droppedFrames() {
      return droppedFrames;
    },
  };
}
