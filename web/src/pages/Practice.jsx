import { useEffect, useRef, useState } from "react";
import useVision from "../vision/useVision";
import { startSession, endSession, postFaults, postLandmarks } from "../api";
import { createLandmarkUploader } from "../session/landmarkUploader";
import { saveSession, saveErrorMessage } from "../session/saveSession";
import FaultList from "../components/FaultList";
import OnboardingModal from "../components/OnboardingModal";
import ConfirmDialog from "../components/ConfirmDialog";

// Map the active fault label strings from useVision into the shape FaultList
// expects. `id` is derived from the fault's identity (stable across frames) so
// the listbox's roving focus/active option survives the 4x/sec state updates.
// Identical labels are collapsed: MediaPipe occasionally tags both hands with
// the same handedness (or "Unknown"), which would otherwise yield duplicate ids
// / React keys and break the listbox's focus management.
function toFaultItems(labels) {
  const seen = new Set();
  const items = [];
  for (const label of labels) {
    const id = label.toLowerCase().replace(/\s+/g, "-");
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label, severity: label.includes("wrist") ? "error" : "warn" });
  }
  return items;
}

// How often sampled skeleton frames are moved out of the vision hook and handed
// to the uploader. Note what this interval does and does NOT bound: a mid-session
// flush only uploads WHOLE chunks, so the replay a crashed tab loses is up to one
// chunk (CHUNK_FRAMES = 300 frames at ~6fps, so ~50s), not 5 seconds. The
// interval controls how promptly full chunks go out; CHUNK_FRAMES controls the
// exposure. Anything shorter here would just add empty wake-ups.
const LANDMARK_FLUSH_INTERVAL_MS = 5_000;

const SIGNIFICANT_THRESHOLD_MS = 500;
const LIVE_WINDOW_MS = 30_000;
const FEEDBACK_LANES = [
  { key: "left_arm_posture", hand: "left", fault_type: "arm_posture" },
  { key: "left_collapsed_wrist", hand: "left", fault_type: "collapsed_wrist" },
  { key: "left_flat_fingers", hand: "left", fault_type: "flat_fingers" },
  { key: "right_arm_posture", hand: "right", fault_type: "arm_posture" },
  { key: "right_collapsed_wrist", hand: "right", fault_type: "collapsed_wrist" },
  { key: "right_flat_fingers", hand: "right", fault_type: "flat_fingers" },
  // Back posture has no handedness — it is one torso, so `hand` is null.
  { key: "back_posture", hand: null, fault_type: "back_posture" },
];

export default function Practice() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  // phase: "idle" | "framing" | "running"
  const [phase, setPhase] = useState("idle");
  const [saving, setSaving] = useState(false);
  const [liveFeedbackEnabled, setLiveFeedbackEnabled] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem("vn-onboarded"));
  const [saveError, setSaveError] = useState(null);     // critical failure, retryable
  const [replayWarning, setReplayWarning] = useState(null); // non-critical, dismissible
  const sessionRef = useRef(null); // { id, startedAt }
  // Mirrors `saving`, but synchronously. React state updates are async, so two
  // clicks dispatched in the SAME task both read the old `saving` (and the same
  // stale JSX guard on the Retry button) and both start a save — which posts
  // every fault row twice. A ref flips before either handler yields.
  const savingRef = useRef(false);
  const uploaderRef = useRef(null); // chunked landmark uploader for the live session
  const pendingSaveRef = useRef(null); // { session, progress } kept for Retry
  const {
    isLoading, error, faults, liveEvents,
    handsDetected, poseDetected, shouldersDetected, isSideView, currentTs,
    start, stop, drainLandmarkFrames, beginLandmarkCapture,
  } = useVision(videoRef, canvasRef);

  // Ship skeleton frames in chunks WHILE the session runs. The old code posted
  // the entire session in one request at Stop, so the request size grew with
  // session length and blew past the body limit after ~20s of practice. Now the
  // request size is fixed and only the number of requests grows.
  useEffect(() => {
    if (phase !== "running") return;
    const timer = setInterval(() => {
      const uploader = uploaderRef.current;
      if (!uploader) return;
      uploader.push(drainLandmarkFrames());
      uploader.flush(); // never throws; a mid-session replay hiccup stays silent
    }, LANDMARK_FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [phase, drainLandmarkFrames]);

  // Step 1: open camera + start detection (no backend session yet)
  const handleSetupCamera = async () => {
    try {
      await start();
      setPhase("framing");
    } catch (e) {
      console.error("Failed to start camera:", e);
    }
  };

  // Step 2: camera looks good — create the backend session and start recording
  const handleConfirmFraming = async () => {
    // Starting a new session abandons any unretried save: the banner that offered
    // Retry is about to disappear, so the payload behind it must go too rather
    // than linger as unreachable state.
    pendingSaveRef.current = null;
    setSaveError(null);
    setReplayWarning(null);
    try {
      const { session_id } = await startSession();
      sessionRef.current = { id: session_id, startedAt: Date.now() };
      // One uploader per session: chunk indices and the pending buffer are
      // session-scoped, so a fresh session must never inherit either.
      uploaderRef.current = createLandmarkUploader({
        post: (frames, chunkIndex) => postLandmarks(session_id, frames, chunkIndex),
      });
      // Throw away frames captured while the user was still aiming the camera and
      // re-zero the replay clock at t=0.
      beginLandmarkCapture();
      setPhase("running");
    } catch (e) {
      setSaveError(`Couldn't start a session: ${e.message}`);
    }
  };

  // Run (or re-run) the save path and translate its result into UI state.
  const runSave = async (session, progress) => {
    if (savingRef.current) return; // a save is already in flight — see savingRef
    savingRef.current = true;
    setSaving(true);
    try {
      const uploader = uploaderRef.current;
      const result = await saveSession(
        session,
        {
          postFaults,
          endSession,
          // Final flush: uploads the last partial chunk too. Resolves rather than
          // rejects, so a missing replay can never fail the session save.
          flushLandmarks: () =>
            uploader ? uploader.flush({ final: true }) : Promise.resolve({ error: null }),
        },
        progress
      );

      if (result.ok) {
        pendingSaveRef.current = null;
        uploaderRef.current = null;
        setSaveError(null);
        setReplayWarning(result.replayWarning);
      } else {
        // Keep the payload AND how far it got, so Retry resumes instead of
        // re-posting fault rows that already landed.
        pendingSaveRef.current = { session, progress: result.progress };
        console.error("Failed to save session:", result.error);
        setSaveError(saveErrorMessage(result.failedStep, result.error));
      }
    } finally {
      // In a `finally` because a latched `saving` is the same user-visible
      // failure as a hung request: the Start button stays disabled forever with
      // no banner explaining why. saveSession is contractually non-throwing, so
      // this should be unreachable — which is exactly why it is cheap insurance.
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleStop = async () => {
    const { events, landmarkFrames } = stop();
    setPhase("idle");

    const current = sessionRef.current;
    sessionRef.current = null;
    if (!current) return; // nothing was ever started — nothing to save

    uploaderRef.current?.push(landmarkFrames);
    await runSave(
      {
        id: current.id,
        durationSeconds: Math.round((Date.now() - current.startedAt) / 1000),
        events,
      },
      {}
    );
  };

  const handleRetrySave = async () => {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    await runSave(pending.session, pending.progress);
  };

  const running = phase === "running";
  const framing = phase === "framing";

  return (
    <main style={{ padding: "32px 0" }}>
      {showOnboarding && <OnboardingModal onDone={() => setShowOnboarding(false)} />}
      <p className="vn-label" style={{ marginBottom: 6 }}>Live Session</p>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Practice</h1>
        {phase === "idle" && (
          <button
            onClick={handleSetupCamera}
            disabled={isLoading || saving}
            className="vn-btn vn-btn--primary"
            style={{ cursor: isLoading || saving ? "wait" : undefined }}
          >
            {isLoading ? "Loading models…" : saving ? "Saving…" : "Start Session"}
          </button>
        )}
        {running && (
          <button onClick={handleStop} className="vn-btn vn-btn--stop">Stop</button>
        )}
        {(running || framing) && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.875rem", color: "var(--ink-muted)" }}>
            <input
              type="checkbox"
              checked={liveFeedbackEnabled}
              onChange={(e) => setLiveFeedbackEnabled(e.target.checked)}
              className="vn-accent-control"
              style={{ width: 16, height: 16, margin: 0 }}
            />
            Enable live feedback
          </label>
        )}
      </div>

      {error && (
        <p style={{ color: "var(--signal-deep)", fontWeight: 600 }}>{error}</p>
      )}

      {saveError && (
        <SaveBanner
          tone="error"
          message={saveError}
          action={pendingSaveRef.current && !saving ? { label: "Retry save", onClick: handleRetrySave } : null}
          // Dismissing drops the ONLY in-memory copy of this session's fault events —
          // there is no way to recover them afterwards. A ✕ reads as "hide this
          // message", so confirm before it silently discards a whole practice.
          onDismiss={() => setConfirmDiscard(true)}
        />
      )}

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard unsaved session?"
        message="This practice session hasn't been saved. Dismissing discards its posture data permanently — you can't get it back."
        confirmLabel="Discard"
        cancelLabel="Keep trying"
        onConfirm={() => {
          pendingSaveRef.current = null;
          uploaderRef.current = null;
          setSaveError(null);
          setConfirmDiscard(false);
        }}
        onCancel={() => setConfirmDiscard(false)}
      />

      {replayWarning && (
        <SaveBanner tone="warn" message={replayWarning} onDismiss={() => setReplayWarning(null)} />
      )}

      {liveFeedbackEnabled && running && (
        <LiveFeedbackPanel running={running} events={liveEvents} currentTs={currentTs} />
      )}

      {running && (
        <section style={{ marginBottom: 16 }}>
          <p className="vn-label" style={{ marginBottom: 6 }}>Posture Faults</p>
          <FaultList faults={toFaultItems(faults)} />
        </section>
      )}

      {/* Video + canvas overlay */}
      <div style={{ position: "relative", display: "inline-block", background: "#000", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
        <video
          ref={videoRef}
          style={{ display: "block", maxWidth: "100%", transform: "scaleX(-1)" }}
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            transform: "scaleX(-1)",
          }}
        />
        {framing && (
          <FramingOverlay
            handsDetected={handsDetected}
            poseDetected={poseDetected}
            shouldersDetected={shouldersDetected}
            isSideView={isSideView}
            onConfirm={handleConfirmFraming}
          />
        )}
      </div>

      {framing && <PostureTip />}

      {phase === "idle" && !isLoading && !saving && (
        <p className="vn-muted" style={{ marginTop: 12 }}>
          Press <strong style={{ color: "var(--ink)" }}>Start Session</strong> to begin webcam posture tracking.
        </p>
      )}
    </main>
  );
}

// A save failure used to be a console.error the user never saw — the replay and
// the session data just vanished. This is the visible half of that fix; the
// repair half is the Retry action, which resumes from the failed step.
function SaveBanner({ tone, message, action, onDismiss }) {
  const isError = tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        border: `1px solid ${isError ? "var(--signal)" : "var(--line-strong)"}`,
        background: isError ? "var(--signal-soft)" : "var(--surface-sunken)",
        color: isError ? "var(--signal-deep)" : "var(--ink-muted)",
        borderRadius: "var(--r-md)",
        padding: "10px 14px",
        marginBottom: 16,
        fontSize: "0.875rem",
        fontWeight: 500,
      }}
    >
      <span style={{ flex: 1, minWidth: 200 }}>{message}</span>
      {action && (
        <button className="vn-btn" onClick={action.onClick} style={{ padding: "6px 12px", fontSize: "0.8rem" }}>
          {action.label}
        </button>
      )}
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 14, padding: 2 }}
      >✕</button>
    </div>
  );
}

function PostureTip() {
  const [dismissing, setDismissing] = useState(false);
  const [gone, setGone] = useState(false);

  const handleDismiss = () => {
    setDismissing(true);
    setTimeout(() => setGone(true), 420);
  };

  if (gone) return null;
  return (
    <>
      <style>{`
        @keyframes postureCardIn {
          0%   { transform: translate(110%, -110%) rotate(40deg) scale(1.6); opacity: 0; }
          60%  { transform: translate(-6%, 4%) rotate(-4deg) scale(1.08); opacity: 1; }
          80%  { transform: translate(2%, -2%) rotate(-1.5deg) scale(0.98); }
          100% { transform: translate(0, 0) rotate(-2deg) scale(1); opacity: 1; }
        }
        @keyframes postureCardOut {
          0%   { transform: translate(0, 0) rotate(-2deg) scale(1); opacity: 1; }
          100% { transform: translate(115%, -115%) rotate(42deg) scale(0.8); opacity: 0; }
        }
        .posture-card-in {
          animation: postureCardIn 0.65s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          transform-origin: top right;
        }
        .posture-card-out {
          animation: postureCardOut 0.4s cubic-bezier(0.55, 0, 1, 0.45) forwards;
          transform-origin: top right;
        }
      `}</style>
      <div
        className={dismissing ? "posture-card-out" : "posture-card-in"}
        style={{
          position: "fixed",
          top: 80,
          right: 24,
          zIndex: 150,
          width: 580,
          willChange: "transform, opacity",
          background: "#fffde7",
          border: "1.5px solid #e0c84a",
          borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12)",
          padding: "12px 12px 14px",
          color: "#2a2200",
        }}
      >
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            position: "absolute",
            top: 7,
            right: 9,
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 15,
            color: "#7a6800",
            lineHeight: 1,
            padding: 2,
          }}
        >✕</button>
        <img
          src="/piano.jpeg"
          alt="Correct vs wrong piano posture"
          style={{ width: "100%", borderRadius: 6, display: "block", marginBottom: 10 }}
        />
        <p style={{ margin: 0, fontSize: "0.78rem", lineHeight: 1.5, fontWeight: 500, color: "#3a2e00" }}>
          Try to mirror the <strong>right posture</strong> as much as possible!
        </p>
      </div>
    </>
  );
}

// Seconds between pressing "Start recording" and the session actually starting,
// so the player has time to get their hands back on the keys instead of the first
// seconds of every session capturing them reaching away from the mouse.
const START_COUNTDOWN_SECONDS = 3;

function FramingOverlay({ handsDetected, poseDetected, shouldersDetected, isSideView, onConfirm }) {
  const [countdown, setCountdown] = useState(null);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      onConfirm();
      return;
    }
    const timer = setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, onConfirm]);

  const checks = [
    {
      label: "Hands visible",
      ok: handsDetected,
      tip: <>Point camera at your hands <strong style={{textTransform:"uppercase"}}>from the side</strong></>,
    },
    {
      label: "Arm in frame",
      ok: poseDetected,
      tip: "Pull back so your elbow is visible",
    },
    {
      label: "Shoulders in frame",
      ok: shouldersDetected,
      tip: "Pull back further so at least one shoulder is visible",
    },
    {
      // Both shoulders spread wide apart means the camera is off to the front
      // at a 3/4 angle. The elbow and wrist geometry every fault check relies on
      // is measured in 2D, so a 3/4 view foreshortens the arm and quietly makes
      // every angle wrong — better to block here than to coach from bad numbers.
      label: "Side-on angle",
      ok: isSideView,
      tip: "Move the camera around to your side — it's at too much of an angle",
    },
  ];

  const allGood = handsDetected && poseDetected && shouldersDetected && isSideView;
  const counting = countdown !== null;

  return (
    <div style={{
      position: "absolute",
      inset: 0,
      background: "rgba(0,0,0,0.62)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      padding: 24,
    }}>
      <p style={{ color: "#fff", fontWeight: 600, fontSize: "0.9rem", margin: 0, letterSpacing: "0.04em", textTransform: "uppercase", opacity: 0.7 }}>
        Camera Setup
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 280 }}>
        {checks.map(({ label, ok, tip }) => (
          <div key={label} style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: ok ? "rgba(21,128,61,0.25)" : "rgba(0,0,0,0.35)",
            border: `1px solid ${ok ? "rgba(21,128,61,0.6)" : "rgba(255,255,255,0.12)"}`,
            borderRadius: 8,
            padding: "10px 14px",
            transition: "background 300ms, border-color 300ms",
          }}>
            <span style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: ok ? "#15803d" : "rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: 11,
              color: "#fff",
              transition: "background 300ms",
            }}>
              {ok ? "✓" : ""}
            </span>
            <div>
              <div style={{ color: ok ? "#4ade80" : "#fff", fontSize: "0.85rem", fontWeight: 600 }}>{label}</div>
              {!ok && <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.78rem", marginTop: 1 }}>{tip}</div>}
            </div>
          </div>
        ))}
      </div>

      <button
        className="vn-btn vn-btn--primary"
        onClick={() => setCountdown(START_COUNTDOWN_SECONDS)}
        disabled={!allGood || counting}
        style={{ opacity: allGood ? 1 : 0.4, cursor: allGood && !counting ? "pointer" : "not-allowed", marginTop: 4 }}
      >
        {counting
          ? `Starting in ${countdown}…`
          : allGood
            ? "Start recording"
            : "Waiting for camera…"}
      </button>
    </div>
  );
}

function LiveFeedbackPanel({ running, events, currentTs }) {
  const nowMs = currentTs || events.reduce((latest, event) => (
    Math.max(latest, event.timestamp_ms + (event.value || 0))
  ), 0);
  const windowStart = Math.max(0, nowMs - LIVE_WINDOW_MS);
  const significantEvents = events.filter((event) => (event.value || 0) >= SIGNIFICANT_THRESHOLD_MS);
  const activeKeys = new Set(
    significantEvents
      .filter((event) => nowMs > 0 && Math.abs((event.timestamp_ms + (event.value || 0)) - nowMs) < 350)
      .map((event) => faultKey(event))
  );
  const totalLiveMs = significantEvents.reduce((sum, event) => sum + (event.value || 0), 0);

  return (
    <section style={{ marginBottom: 16 }}>
      <style>{`
        @keyframes livePulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.28); opacity: 0.55; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vn-live-dot { animation: none !important; }
        }
      `}</style>
      <div style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        background: "var(--surface)",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "12px 14px",
          borderBottom: "1px solid var(--line)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span className="vn-live-dot" style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: running ? "var(--accent)" : "var(--line-strong)",
              animation: running ? "livePulse 1.2s ease-in-out infinite" : "none",
              flex: "0 0 auto",
            }} />
            <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Live Feedback</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--ink-muted)", fontSize: 13 }}>
            <span className="vn-label" style={{ color: "var(--ink-muted)" }}>{running ? "Last 30s" : "Paused"}</span>
            <strong className="vn-data" style={{ color: "var(--ink)" }}>{formatLiveTime(totalLiveMs)} total</strong>
          </div>
        </div>

        {running ? (
          <div style={{ padding: "12px 14px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "148px minmax(220px, 1fr) 72px", gap: 10, alignItems: "center" }}>
              {FEEDBACK_LANES.map((lane) => {
                const laneEvents = significantEvents.filter((event) => faultKey(event) === lane.key);
                const laneTotalMs = laneEvents.reduce((sum, event) => sum + (event.value || 0), 0);
                const isActive = activeKeys.has(lane.key);

                return (
                  <LiveFeedbackLane
                    key={lane.key}
                    lane={lane}
                    events={laneEvents}
                    nowMs={nowMs}
                    windowStart={windowStart}
                    totalMs={laneTotalMs}
                    active={isActive}
                  />
                );
              })}
            </div>
            {significantEvents.length === 0 && (
              <div style={{ color: "var(--ink-muted)", fontSize: 13, marginTop: 10 }}>
                No sustained feedback yet. Brief blips under 0.5s stay out of this monitor.
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: "var(--ink-muted)", padding: "14px 16px", fontSize: 14 }}>
            Start a session and sustained posture notes will stream here.
          </div>
        )}
      </div>
    </section>
  );
}

function LiveFeedbackLane({ lane, events, nowMs, windowStart, totalMs, active }) {
  const windowDuration = Math.max(1, nowMs - windowStart || LIVE_WINDOW_MS);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{
          color: active ? "var(--ink)" : "var(--ink-muted)",
          fontSize: 13,
          fontWeight: active ? 700 : 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {faultLabel(lane.fault_type, lane.hand)}
        </span>
      </div>
      <div style={{
        position: "relative",
        height: 28,
        background: "var(--surface-sunken)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
      }}>
        {[0, 1, 2, 3].map((tick) => (
          <span
            key={tick}
            style={{
              position: "absolute",
              left: `${(tick / 3) * 100}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: tick === 3 ? "var(--line-strong)" : "var(--line)",
            }}
          />
        ))}
        {events.map((event, index) => {
          // Use raw positions — container has overflow:hidden so pills clip naturally
          // at the left edge instead of clamping (which made tails look stuck).
          const left = ((event.timestamp_ms - windowStart) / windowDuration) * 100;
          const width = Math.max(1.5, ((event.value || 0) / windowDuration) * 100);
          const isLatest = active && index === events.length - 1;

          return (
            <span
              key={`${event.timestamp_ms}-${index}`}
              title={`${faultLabel(event.fault_type, event.hand)}: ${formatLiveTime(event.value || 0)}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                top: 6,
                bottom: 6,
                borderRadius: 999,
                background: "var(--signal)",
                opacity: isLatest ? 1 : 0.72,
                boxShadow: isLatest ? "0 0 0 3px var(--signal-soft)" : "none",
                transition: "left 180ms linear, width 180ms linear",
              }}
            />
          );
        })}
        <span style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: "var(--accent)",
        }} />
      </div>
      <div className="vn-data" style={{ color: active ? "var(--ink)" : "var(--ink-muted)", fontSize: 12, fontWeight: active ? 700 : 500, textAlign: "right" }}>
        {formatLiveTime(totalMs)}
      </div>
    </>
  );
}

function InitialsBadge({ children }) {
  return (
    <span className="vn-data" style={{
      width: 24,
      height: 20,
      borderRadius: 5,
      background: "var(--ink)",
      color: "var(--surface)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: 0,
      lineHeight: 1,
      flex: "0 0 auto",
    }}>
      {children}
    </span>
  );
}

function faultLabel(type, hand) {
  const t = type === "collapsed_wrist" ? "Wrist Collapsed" : "Arm Posture";
  const h = hand ? hand.charAt(0).toUpperCase() + hand.slice(1) : "";
  return `${h} ${t}`.trim();
}

function faultInitials(type, hand) {
  const handInitial = hand?.charAt(0).toUpperCase() ?? "";
  const typeInitial = type === "collapsed_wrist" ? "W" : "A";
  return `${handInitial}${typeInitial}`;
}

function faultKey(event) {
  return `${event.hand ?? ""}_${event.fault_type}`;
}

function formatLiveTime(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}
