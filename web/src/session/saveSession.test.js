// saveSession.test.js — vitest suite for the end-of-session write path.
// ---------------------------------------------------------------------------
// The behaviours worth pinning down are the ones the old Promise.all version
// got wrong:
//   - faults are posted BEFORE the session is ended (total_faults is derived
//     server-side from the rows that exist at PATCH time)
//   - a critical failure stops the remaining critical steps (no half-written,
//     plausible-looking session) and reports WHICH step failed
//   - a retry resumes from where it stopped instead of re-posting fault rows
//   - fault events go up in bounded batches: the server rejects >5000 in one
//     request with a 400 that Retry can never clear, and a real recorded session
//     in this project hit 24.5 events/sec (5000 in ~3.4 minutes)
//   - a replay/landmark failure is a warning on a SAVED session, never a
//     save failure — the landmark_frames table may not even exist
//
// Run:  npm test   (vitest run)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { saveSession, saveErrorMessage, FAULT_BATCH_SIZE } from "./saveSession.js";

const SESSION = {
  id: "11111111-2222-3333-4444-555555555555",
  durationSeconds: 90,
  events: [{ fault_type: "collapsed_wrist", hand: "left", timestamp_ms: 10, value: 800 }],
};

function deps(overrides = {}) {
  const order = [];
  const d = {
    postFaults: vi.fn(async () => { order.push("faults"); }),
    endSession: vi.fn(async () => { order.push("end"); }),
    flushLandmarks: vi.fn(async () => { order.push("landmarks"); return { error: null }; }),
    ...overrides,
  };
  return { deps: d, order };
}

describe("happy path", () => {
  it("posts faults, then ends the session, then flushes the replay", async () => {
    const { deps: d, order } = deps();
    const result = await saveSession(SESSION, d);

    expect(order).toEqual(["faults", "end", "landmarks"]);
    expect(result).toMatchObject({ ok: true, failedStep: null, replayWarning: null });
    expect(d.endSession).toHaveBeenCalledWith(SESSION.id, 90, 1);
  });
});

describe("critical failures", () => {
  it("stops before ending the session when faults fail", async () => {
    const { deps: d } = deps({
      postFaults: vi.fn(async () => { throw new Error("Session not found"); }),
    });

    const result = await saveSession(SESSION, d);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("faults");
    // Leaving the session un-ended is deliberate: a visibly unfinished session
    // beats a closed one advertising total_faults: 0.
    expect(d.endSession).not.toHaveBeenCalled();
    expect(d.flushLandmarks).not.toHaveBeenCalled();
    // `faultsSentThrough` counts events already inserted — a boolean cannot
    // describe "3 of 5 batches landed", which is what a retry has to resume from.
    expect(result.progress).toEqual({ faultsSentThrough: 0, sessionEnded: false });
  });

  it("reports the end step when only PATCH fails", async () => {
    const { deps: d } = deps({
      endSession: vi.fn(async () => { throw new Error("Could not end session"); }),
    });

    const result = await saveSession(SESSION, d);

    expect(result.failedStep).toBe("end");
    expect(result.progress).toEqual({ faultsSentThrough: 1, sessionEnded: false });
  });

  it("resumes from the failed step on retry instead of re-posting faults", async () => {
    // Re-running postFaults would insert a second copy of every fault row and
    // inflate total_faults, which the server recomputes by counting rows.
    let endShouldFail = true;
    const { deps: d } = deps({
      endSession: vi.fn(async () => {
        if (endShouldFail) throw new Error("network");
      }),
    });

    const first = await saveSession(SESSION, d);
    expect(first.ok).toBe(false);

    endShouldFail = false;
    const second = await saveSession(SESSION, d, first.progress);

    expect(second.ok).toBe(true);
    expect(d.postFaults).toHaveBeenCalledTimes(1); // NOT retried
    expect(d.endSession).toHaveBeenCalledTimes(2);
  });
});

describe("fault batching", () => {
  const manyEvents = (n) =>
    Array.from({ length: n }, (_, i) => ({
      fault_type: "collapsed_wrist", hand: "left", timestamp_ms: i * 10, value: 600,
    }));

  it("never posts more than one batch worth of events in a single request", async () => {
    const events = manyEvents(FAULT_BATCH_SIZE * 2 + 500);
    const { deps: d } = deps();

    const result = await saveSession({ ...SESSION, events }, d);

    expect(result.ok).toBe(true);
    const sizes = d.postFaults.mock.calls.map(([, batch]) => batch.length);
    expect(sizes).toEqual([FAULT_BATCH_SIZE, FAULT_BATCH_SIZE, 500]);
    // Every event exactly once, in order — a batching bug that drops or repeats
    // a slice would still "succeed", so assert the reassembled stream.
    const sent = d.postFaults.mock.calls.flatMap(([, batch]) => batch);
    expect(sent).toEqual(events);
  });

  it("stays under the server cap that Retry cannot clear", () => {
    // The server hard-rejects >5000 events with a 400. If someone raises this
    // constant past that, sessions start failing permanently instead of slowly.
    expect(FAULT_BATCH_SIZE).toBeLessThan(5000);
  });

  it("resumes at the failed batch on retry instead of re-posting the ones that landed", async () => {
    const events = manyEvents(FAULT_BATCH_SIZE * 2 + 10);
    let failAt = 1; // reject the SECOND batch
    let call = 0;
    const { deps: d } = deps({
      postFaults: vi.fn(async () => {
        if (call++ === failAt) throw new Error("network");
      }),
    });

    const first = await saveSession({ ...SESSION, events }, d);

    expect(first.ok).toBe(false);
    expect(first.failedStep).toBe("faults");
    expect(first.progress.faultsSentThrough).toBe(FAULT_BATCH_SIZE);
    expect(d.endSession).not.toHaveBeenCalled();

    failAt = -1;
    const second = await saveSession({ ...SESSION, events }, d, first.progress);

    expect(second.ok).toBe(true);
    // 1 landed + 1 failed + 2 on retry. The batch that landed is not re-sent.
    expect(d.postFaults).toHaveBeenCalledTimes(4);
    const retried = d.postFaults.mock.calls.slice(2).flatMap(([, batch]) => batch);
    expect(retried).toEqual(events.slice(FAULT_BATCH_SIZE));
  });

  it("still ends the session with the FULL event count, not the last batch", async () => {
    const events = manyEvents(FAULT_BATCH_SIZE + 7);
    const { deps: d } = deps();

    await saveSession({ ...SESSION, events }, d);

    expect(d.endSession).toHaveBeenCalledWith(SESSION.id, 90, FAULT_BATCH_SIZE + 7);
  });

  it("posts nothing when a session recorded no faults", async () => {
    const { deps: d } = deps();
    const result = await saveSession({ ...SESSION, events: [] }, d);

    expect(result.ok).toBe(true);
    expect(d.postFaults).not.toHaveBeenCalled();
    expect(d.endSession).toHaveBeenCalledWith(SESSION.id, 90, 0);
  });
});

describe("replay is best-effort", () => {
  it("still reports a saved session when the replay upload failed", async () => {
    const { deps: d } = deps({
      flushLandmarks: vi.fn(async () => ({ error: new Error("Replay storage is not set up") })),
    });

    const result = await saveSession(SESSION, d);

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeNull();
    expect(result.replayWarning).toMatch(/Replay storage is not set up/);
  });

  it("warns when the uploader gave up earlier in the session", async () => {
    const { deps: d } = deps({
      flushLandmarks: vi.fn(async () => ({ error: null, disabledReason: "boom" })),
    });

    const result = await saveSession(SESSION, d);
    expect(result.ok).toBe(true);
    expect(result.replayWarning).toMatch(/boom/);
  });

  it("survives a flushLandmarks that rejects outright", async () => {
    const { deps: d } = deps({
      flushLandmarks: vi.fn(async () => { throw new Error("bug in uploader"); }),
    });

    const result = await saveSession(SESSION, d);

    expect(result.ok).toBe(true);
    expect(result.replayWarning).toMatch(/bug in uploader/);
  });
});

describe("dropped replay frames are reported, not hidden", () => {
  it("warns that the replay has a gap when the uploader dropped frames", async () => {
    // The uploader counted drops from the start; nothing ever showed them, so a
    // replay with a hole in it looked complete.
    const { deps: d } = deps({
      flushLandmarks: vi.fn(async () => ({ error: null, disabledReason: null, droppedFrames: 42 })),
    });

    const result = await saveSession(SESSION, d);

    expect(result.ok).toBe(true);
    expect(result.replayWarning).toMatch(/42/);
    expect(result.replayWarning).toMatch(/gap/i);
    // A gap is NOT the same as "couldn't be stored" — the replay does exist.
    expect(result.replayWarning).not.toMatch(/couldn't be stored/i);
  });

  it("says nothing when no frames were dropped", async () => {
    const { deps: d } = deps({
      flushLandmarks: vi.fn(async () => ({ error: null, droppedFrames: 0 })),
    });
    const result = await saveSession(SESSION, d);
    expect(result.replayWarning).toBeNull();
  });
});

describe("saveErrorMessage", () => {
  it("names the step and includes the underlying reason", () => {
    expect(saveErrorMessage("faults", new Error("Session not found")))
      .toBe("Couldn't save this session's posture events: Session not found");
    expect(saveErrorMessage("end", new Error("nope"))).toMatch(/finish saving this session: nope/);
  });

  it("does not print 'undefined' when the error has no message", () => {
    expect(saveErrorMessage("end", {})).toMatch(/unknown error/);
  });
});
