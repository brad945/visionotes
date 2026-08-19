/** @vitest-environment jsdom */
// Practice.test.jsx — the USER-VISIBLE half of the save-path fix.
// ---------------------------------------------------------------------------
// saveSession.test.js proves the save path returns the right result object.
// That is not the bug: the bug was that a failed save was a console.error the
// user never saw, so the session (and its replay) vanished silently. That can
// only be verified by rendering. Two claims, asserted on the DOM:
//
//   A. a CRITICAL failure (faults) shows an alert with a Retry action
//   B. a REPLAY failure shows a non-blocking status note and NO alert — a
//      missing replay must never read as "your practice wasn't saved"
//
// Run:  npm test   (vitest run)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("../api", () => ({
  startSession: vi.fn(async () => ({ session_id: "11111111-2222-3333-4444-555555555555" })),
  endSession: vi.fn(async () => ({})),
  postFaults: vi.fn(async () => ({ inserted: 1 })),
  postLandmarks: vi.fn(async () => ({ stored: 1 })),
}));

// The real hook needs a webcam, WASM and models. All this test needs from it is
// the framing checks passing and a stop() that hands back a session's worth of data.
vi.mock("../vision/useVision", () => ({
  default: () => ({
    isLoading: false,
    error: null,
    faults: [],
    liveEvents: [],
    handsDetected: true,
    poseDetected: true,
    shouldersDetected: true,
    currentTs: 1000,
    start: vi.fn(async () => {}),
    stop: vi.fn(() => ({
      events: [{ fault_type: "collapsed_wrist", hand: "left", timestamp_ms: 10, value: 900 }],
      landmarkFrames: [{ t: 0, hands: null, pose: null }],
    })),
    drainLandmarkFrames: vi.fn(() => []),
    beginLandmarkCapture: vi.fn(),
  }),
}));

const api = await import("../api");
const Practice = (await import("./Practice.jsx")).default;

// Walk the real UI: Start Session -> Start recording -> Stop.
async function runASession() {
  render(<Practice />);
  fireEvent.click(screen.getByRole("button", { name: "Start Session" }));
  const startRecording = await screen.findByRole("button", { name: "Start recording" });
  fireEvent.click(startRecording);
  const stopButton = await screen.findByRole("button", { name: "Stop" });
  fireEvent.click(stopButton);
}

beforeEach(() => {
  localStorage.setItem("vn-onboarded", "1"); // skip the onboarding modal
  vi.clearAllMocks();
  // clearAllMocks resets calls but NOT implementations, so restate the happy-path
  // defaults here — otherwise one test's rejection leaks into the next.
  api.startSession.mockResolvedValue({ session_id: "11111111-2222-3333-4444-555555555555" });
  api.endSession.mockResolvedValue({});
  api.postFaults.mockResolvedValue({ inserted: 1 });
  api.postLandmarks.mockResolvedValue({ stored: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a critical save failure is visible and repairable", () => {
  it("shows an alert with a Retry action when faults fail to save", async () => {
    api.postFaults.mockRejectedValueOnce(new Error("Session not found"));

    await runASession();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/posture events/i);
    expect(alert.textContent).toMatch(/Session not found/);
    expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy();
  });

  it("clears the alert when the retry succeeds, without re-posting faults", async () => {
    api.postFaults.mockRejectedValueOnce(new Error("network"));

    await runASession();
    await screen.findByRole("alert");

    // The first attempt failed AT the faults step, so the retry re-posts them
    // (call 2) and then ends the session — which the first attempt never reached.
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(api.postFaults).toHaveBeenCalledTimes(2);
    expect(api.endSession).toHaveBeenCalledTimes(1);
  });
});

describe("a double-clicked Retry saves once", () => {
  it("does not re-post fault rows when Retry is clicked twice in the same task", async () => {
    // The `!saving` guard on the button is React state: both clicks in one task
    // read the SAME stale value and the same already-rendered DOM, so both used
    // to start a save and every fault row went in twice. total_faults is derived
    // by counting rows server-side, so the duplicates are permanent and visible.
    api.postFaults.mockRejectedValueOnce(new Error("network"));

    await runASession();
    await screen.findByRole("alert");
    expect(api.postFaults).toHaveBeenCalledTimes(1); // the failed attempt

    const retry = screen.getByRole("button", { name: "Retry save" });
    // Native dispatch, not fireEvent: two clicks with nothing awaited between
    // them is exactly the race, and awaiting between them would hide it.
    retry.click();
    retry.click();

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(api.postFaults).toHaveBeenCalledTimes(2); // 1 failed + 1 retry, NOT 3
    expect(api.endSession).toHaveBeenCalledTimes(1);
  });
});

describe("a replay failure is not a save failure", () => {
  it("shows a non-blocking note and no alert when the landmark upload fails", async () => {
    api.postLandmarks.mockRejectedValue(new Error("Replay storage is not set up on this server"));

    await runASession();

    const note = await screen.findByRole("status");
    expect(note.textContent).toMatch(/Session saved/i);
    expect(note.textContent).toMatch(/replay/i);
    expect(screen.queryByRole("alert")).toBeNull();
    // The session itself still completed.
    expect(api.postFaults).toHaveBeenCalledTimes(1);
    expect(api.endSession).toHaveBeenCalledTimes(1);
  });

  it("says nothing at all when everything saved", async () => {
    await runASession();

    await waitFor(() => expect(api.endSession).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("landmark upload wiring", () => {
  it("uploads the final frames as chunk 0 of that session", async () => {
    await runASession();

    await waitFor(() => expect(api.postLandmarks).toHaveBeenCalled());
    const [sessionId, frames, chunkIndex] = api.postLandmarks.mock.calls[0];
    expect(sessionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(frames).toEqual([{ t: 0, hands: null, pose: null }]);
    expect(chunkIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Dismissing a failed save destroys the only in-memory copy of the session's
// fault events — there is no server copy to fall back on, because the save is
// what failed. A bare ✕ reads as "hide this message", so it must confirm first.
// ---------------------------------------------------------------------------
describe("dismissing an unsaved session asks first", () => {
  it("does not discard the retry payload until the discard is confirmed", async () => {
    api.postFaults.mockRejectedValue(new Error("network"));

    await runASession();
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    // Still recoverable: the confirm is open and Retry has NOT been taken away.
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/discard/i);
    expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy();

    // Backing out leaves the session exactly as repairable as before.
    fireEvent.click(screen.getByRole("button", { name: "Keep trying" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry save" })).toBeTruthy();
  });

  it("discards only after confirmation", async () => {
    api.postFaults.mockRejectedValue(new Error("network"));

    await runASession();
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("button", { name: "Retry save" })).toBeNull();
  });
});
