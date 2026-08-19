// landmarkUploader.test.js — vitest suite for the chunked replay uploader.
// ---------------------------------------------------------------------------
// The uploader exists so that request SIZE stops growing with session length.
// What's worth testing here is not "does it call post" but the four ways a
// naive chunker corrupts data:
//   - chunk index advancing on a FAILED post (leaves a silent hole in the stream)
//   - overlapping flushes reading the same buffer (same frames, two indices)
//   - a partial tail never being sent (replay truncated at the last full chunk)
//   - an unavailable endpoint retried forever (memory growth + API spam)
//
// Run:  npm test   (vitest run)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { createLandmarkUploader, CHUNK_FRAMES } from "./landmarkUploader.js";

// Frames are opaque to the uploader; an id is enough to track ordering.
const makeFrames = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ t: (offset + i) * 160, id: offset + i }));

// Records every (chunk, index) pair the uploader posts.
function recorder({ failTimes = 0, failAlways = false } = {}) {
  const calls = [];
  let failures = 0;
  const post = vi.fn(async (frames, chunkIndex) => {
    calls.push({ ids: frames.map((f) => f.id), chunkIndex });
    if (failAlways || failures < failTimes) {
      failures += 1;
      throw new Error("boom");
    }
  });
  return { post, calls };
}

describe("chunking", () => {
  it("uploads only whole chunks on a normal flush, leaving the remainder buffered", async () => {
    const { post, calls } = recorder();
    const up = createLandmarkUploader({ post, chunkFrames: 10 });

    up.push(makeFrames(25));
    const result = await up.flush();

    expect(calls.map((c) => c.chunkIndex)).toEqual([0, 1]);
    expect(calls[0].ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(calls[1].ids[0]).toBe(10);
    expect(result.uploadedChunks).toBe(2);
    expect(up.pendingFrames).toBe(5); // partial tail waits for more frames
  });

  it("sends the partial tail on a final flush", async () => {
    const { post, calls } = recorder();
    const up = createLandmarkUploader({ post, chunkFrames: 10 });

    up.push(makeFrames(25));
    await up.flush({ final: true });

    expect(calls.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(calls[2].ids).toEqual([20, 21, 22, 23, 24]);
    expect(up.pendingFrames).toBe(0);
  });

  it("does not post at all when nothing is buffered", async () => {
    const { post } = recorder();
    const up = createLandmarkUploader({ post, chunkFrames: 10 });

    await up.flush({ final: true });

    expect(post).not.toHaveBeenCalled();
  });

  it("carries frames across flushes so chunk boundaries stay uniform", async () => {
    const { post, calls } = recorder();
    const up = createLandmarkUploader({ post, chunkFrames: 10 });

    // Three drains of 4 frames each: nothing goes out until a full chunk exists.
    up.push(makeFrames(4, 0));
    await up.flush();
    expect(calls).toHaveLength(0);

    up.push(makeFrames(4, 4));
    await up.flush();
    expect(calls).toHaveLength(0);

    up.push(makeFrames(4, 8));
    await up.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].ids).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("failure handling", () => {
  it("does NOT advance the chunk index on a failed post", async () => {
    // The bug this guards: advancing first stores chunks 0 and 2 with no error
    // anywhere, and the reader silently concatenates a stream with a hole in it.
    const { post, calls } = recorder({ failTimes: 1 });
    const up = createLandmarkUploader({ post, chunkFrames: 10 });

    up.push(makeFrames(10));
    const first = await up.flush();
    expect(first.error).toBeTruthy();
    expect(up.nextChunkIndex).toBe(0);
    expect(up.pendingFrames).toBe(10); // frames kept for the retry

    const second = await up.flush();
    expect(second.error).toBeNull();
    expect(calls.map((c) => c.chunkIndex)).toEqual([0, 0]); // same index, retried
    expect(calls[1].ids).toEqual(calls[0].ids); // and exactly the same frames
    expect(up.nextChunkIndex).toBe(1);
  });

  it("stops after MAX_FAILURES consecutive failures and drops its buffer", async () => {
    const { post } = recorder({ failAlways: true });
    const up = createLandmarkUploader({ post, chunkFrames: 10, maxFailures: 3 });

    up.push(makeFrames(10));
    await up.flush();
    await up.flush();
    expect(up.disabledReason).toBeNull();
    await up.flush();

    expect(up.disabledReason).toBe("boom");
    expect(up.pendingFrames).toBe(0);

    // Disabled means disabled: no more requests, no more buffering.
    const callsSoFar = post.mock.calls.length;
    up.push(makeFrames(50, 100));
    const after = await up.flush({ final: true });
    expect(post.mock.calls.length).toBe(callsSoFar);
    expect(up.pendingFrames).toBe(0);
    expect(after.disabledReason).toBe("boom");
  });

  it("never throws out of flush, even though post rejects", async () => {
    const { post } = recorder({ failAlways: true });
    const up = createLandmarkUploader({ post, chunkFrames: 5 });

    up.push(makeFrames(5));
    // Would reject if the uploader let post's error escape — replay failures
    // must never be able to fail the session save.
    await expect(up.flush({ final: true })).resolves.toMatchObject({ uploadedChunks: 0 });
  });

  it("resets the failure count after a success", async () => {
    const { post } = recorder({ failTimes: 2 });
    const up = createLandmarkUploader({ post, chunkFrames: 5, maxFailures: 3 });

    up.push(makeFrames(5));
    await up.flush(); // fail 1
    await up.flush(); // fail 2
    await up.flush(); // success -> counter back to 0
    expect(up.disabledReason).toBeNull();
    expect(up.nextChunkIndex).toBe(1);
  });
});

describe("concurrency", () => {
  it("serializes overlapping flushes instead of double-posting", async () => {
    // Two concurrent flushes reading the same buffer would each slice frames
    // 0..9 and post them under indices 0 and 1.
    let release;
    const gate = new Promise((r) => { release = r; });
    const calls = [];
    let first = true;
    const post = vi.fn(async (frames, chunkIndex) => {
      calls.push({ ids: frames.map((f) => f.id), chunkIndex });
      if (first) { first = false; await gate; }
    });

    const up = createLandmarkUploader({ post, chunkFrames: 10 });
    up.push(makeFrames(10));
    const a = up.flush();          // starts, blocks inside post
    up.push(makeFrames(10, 10));
    const b = up.flush();          // must wait for `a`, not race it
    release();
    await Promise.all([a, b]);

    expect(calls.map((c) => c.chunkIndex)).toEqual([0, 1]);
    expect(calls[0].ids[0]).toBe(0);
    expect(calls[1].ids[0]).toBe(10); // no frame uploaded twice
  });
});

describe("memory bound", () => {
  it("drops the newest frames past the pending ceiling and counts them", async () => {
    const { post } = recorder();
    const up = createLandmarkUploader({ post, chunkFrames: 10, maxPendingFrames: 15 });

    up.push(makeFrames(20));

    expect(up.pendingFrames).toBe(15);
    expect(up.droppedFrames).toBe(5);

    // Kept frames are the OLDEST ones, so the replay is contiguous from t=0
    // rather than having a gap punched in the middle.
    await up.flush({ final: true });
    expect(post.mock.calls[0][0][0].id).toBe(0);
  });
});

describe("payload bound (the reason this module exists)", () => {
  // A realistic frame: two hands x 21 [x,y] points + 6 arm points, 4dp — the
  // shape useVision samples at ~6fps.
  const realisticFrame = (i) => ({
    t: i * 160,
    hands: ["Left", "Right"].map((h) => ({
      h,
      lm: Array.from({ length: 21 }, (_, k) => [
        +(0.4 + k * 0.001).toFixed(4),
        +(0.5 + k * 0.001).toFixed(4),
      ]),
    })),
    pose: Array.from({ length: 6 }, (_, k) => [+(0.3 + k * 0.01).toFixed(4), +(0.6 + k * 0.01).toFixed(4)]),
  });

  it("keeps one request well under the server's 1mb body limit", async () => {
    const posted = [];
    const up = createLandmarkUploader({ post: async (frames) => { posted.push(frames); } });

    // 30 minutes of practice at ~6fps — the case that produced a ~9MB single
    // request before, and 413'd at 2mb no matter how the limit was tuned.
    const THIRTY_MIN_FRAMES = 30 * 60 * 6;
    for (let i = 0; i < THIRTY_MIN_FRAMES; i += 100) {
      up.push(Array.from({ length: 100 }, (_, k) => realisticFrame(i + k)));
      await up.flush();
    }
    await up.flush({ final: true });

    const sizes = posted.map((chunk) => JSON.stringify({ frames: chunk, chunk_index: 0 }).length);
    const largest = Math.max(...sizes);

    expect(largest).toBeLessThan(1024 * 1024); // server JSON_BODY_LIMIT
    // Request size is a function of CHUNK_FRAMES, not of session length: the
    // whole point. Every chunk but the tail is exactly CHUNK_FRAMES long.
    expect(posted.every((c) => c.length <= CHUNK_FRAMES)).toBe(true);
    expect(posted.reduce((n, c) => n + c.length, 0)).toBe(THIRTY_MIN_FRAMES);
  });

  it("stays under the server's per-chunk frame cap", () => {
    const SERVER_MAX_FRAMES_PER_CHUNK = 600; // server/index.js
    expect(CHUNK_FRAMES).toBeLessThanOrEqual(SERVER_MAX_FRAMES_PER_CHUNK);
  });
});
