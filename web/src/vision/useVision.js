/**
 * useVision — React hook that manages webcam capture, MediaPipe hand + pose
 * detection, fault analysis, and canvas rendering.
 *
 * Attaches to a <video> and <canvas> via refs. Caller provides refs and gets
 * back { isLoading, error, faults, start, stop }.
 */

import { useRef, useState, useCallback, useEffect } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";

import {
  isWristCollapsed,
  WRIST_FAULT_INDICES,
  checkArmPosture,
} from "../logic/faults";
import { FaultSmoother } from "./faults";
import { drawHand, drawArms } from "./draw";

// CDN path for the WASM + model files MediaPipe needs at runtime.
// PINNED deliberately: @latest would let an upstream release change the WASM under a
// build that never shipped, and it must match the installed @mediapipe/tasks-vision
// version in package.json — a mismatched loader and JS API can fail at runtime.
const TASKS_VISION_VERSION = "0.10.35";
const VISION_WASM_CDN =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

export default function useVision(videoRef, canvasRef) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [faults, setFaults] = useState([]); // current active fault labels
  const [liveEvents, setLiveEvents] = useState([]);
  const [stats, setStats] = useState({ fps: 0, width: 0, height: 0 });
  const [handsDetected, setHandsDetected] = useState(false);
  const [poseDetected, setPoseDetected] = useState(false);
  const [shouldersDetected, setShouldersDetected] = useState(false);
  const [currentTs, setCurrentTs] = useState(0);

  // Mutable refs that persist across renders without re-triggering them
  const handLandmarkerRef = useRef(null);
  const poseLandmarkerRef = useRef(null);
  const rafIdRef = useRef(null);
  const streamRef = useRef(null);
  const lastTsRef = useRef(0);
  const wristSmootherRef = useRef(new FaultSmoother());
  const armSmootherRef = useRef(new FaultSmoother());
  const fpsFramesRef = useRef([]); // timestamps of recent frames for FPS calc
  const lastStateUpdateRef = useRef(0); // throttle React state updates
  const landmarkFramesRef = useRef([]); // skeleton replay frames
  const lastSampleRef = useRef(0);      // timestamp of last sampled frame
  const sessionStartRef = useRef(0);    // performance.now() when session started

  // ---- initialise models (once) ----
  const initModels = useCallback(async () => {
    if (handLandmarkerRef.current) return; // already initialised
    setIsLoading(true);
    setError(null);
    try {
      const fileset = await FilesetResolver.forVisionTasks(VISION_WASM_CDN);

      const [hand, pose] = await Promise.all([
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minTrackingConfidence: 0.5,
        }),
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL_URL },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }),
      ]);

      handLandmarkerRef.current = hand;
      poseLandmarkerRef.current = pose;
    } catch (e) {
      setError(`Model load failed: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ---- per-frame detection loop ----
  const detectLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafIdRef.current = requestAnimationFrame(detectLoop);
      return;
    }

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Strictly increasing timestamp (ms) — required by MediaPipe VIDEO mode
    const now = performance.now();
    const ts = Math.max(Math.floor(now), lastTsRef.current + 1);
    lastTsRef.current = ts;

    const activeFaults = [];
    let frameHandsDetected = false;
    let framePoseDetected = false;
    let frameShouldersDetected = false;

    // Detection results are hoisted so the replay sampler below can REUSE them.
    // They describe this exact video frame, so re-detecting for the sampler would
    // burn a second full inference to recompute an identical answer.
    let handResult = null;
    let poseResult = null;

    // --- Hands ---
    try {
      handResult = handLandmarkerRef.current.detectForVideo(video, ts);
      if (handResult.landmarks && handResult.handedness) {
        frameHandsDetected = handResult.landmarks.length > 0;
        for (let i = 0; i < handResult.landmarks.length; i++) {
          const lm = handResult.landmarks[i];
          // handedness label from MediaPipe is the hand's own label (mirrored in selfie view)
          const label = handResult.handedness[i]?.[0]?.categoryName ?? "Unknown";

          const collapsed = isWristCollapsed(lm);
          const faultIndices = new Set();
          // MediaPipe returns "Unknown" when it cannot tell which hand it is seeing.
          // The `hand` column only accepts 'left'/'right' (or NULL), so posting
          // "unknown" fails the ENTIRE fault batch with a 400 that Retry can never
          // clear — losing the whole session's faults. NULL is the honest value:
          // the fault was real, the handedness was not determined.
          const handLabel = label.toLowerCase();
          const hand = handLabel === "left" || handLabel === "right" ? handLabel : null;
          const { active } = wristSmootherRef.current.push(
            label, collapsed, "collapsed_wrist", hand, ts
          );

          if (active) {
            for (const idx of WRIST_FAULT_INDICES) faultIndices.add(idx);
            activeFaults.push(`${label} wrist collapsed`);
          }

          drawHand(ctx, lm, w, h, faultIndices);
        }
      }
    } catch {
      // skip frame on detection error (e.g. timestamp hiccup)
    }

    // --- Pose (arms) ---
    // Use a fresh timestamp that's strictly greater than the hand one
    const poseTs = lastTsRef.current + 1;
    lastTsRef.current = poseTs;

    try {
      poseResult = poseLandmarkerRef.current.detectForVideo(video, poseTs);
      if (poseResult.landmarks && poseResult.landmarks.length > 0) {
        framePoseDetected = true;
        const body = poseResult.landmarks[0];
        const leftShoulder = body[11];
        const rightShoulder = body[12];
        frameShouldersDetected = (leftShoulder?.visibility ?? 0) > 0.5 || (rightShoulder?.visibility ?? 0) > 0.5;
        const faultArms = new Set();

        for (const side of ["left", "right"]) {
          const { fault } = checkArmPosture(body, side);
          const { active } = armSmootherRef.current.push(
            side, fault, "arm_posture", side, poseTs
          );
          if (active) {
            faultArms.add(side);
            activeFaults.push(`${side} arm posture`);
          }
        }

        drawArms(ctx, body, w, h, faultArms);
      }
    } catch {
      // skip frame
    }

    // --- Skeleton frame sampling (~6fps) ---
    // Sample hand + pose landmarks at ~6fps for replay. Only x/y stored (no z)
    // and rounded to 4dp to keep the JSON compact. Pose stores only the 6 arm
    // indices (11–16); hands store all 21 knuckle points.
    //
    // This REUSES handResult/poseResult from the detection above rather than
    // calling detectForVideo again. It used to re-detect both models ~6x/second
    // on a frame that had just been processed — a second hand inference and a
    // second pose inference for an answer already in memory. On a 6fps sample
    // against a loop already running two inferences per frame, that was roughly
    // a third of all inference work spent recomputing known values, and it
    // showed up as visible lag between the player and the drawn skeleton.
    if (now - lastSampleRef.current > 160) {
      lastSampleRef.current = now;
      const frameT = Math.round(now - sessionStartRef.current);
      let hands = null;
      let pose = null;

      if (handResult?.landmarks?.length) {
        hands = handResult.landmarks.map((lm, i) => ({
          h: handResult.handedness?.[i]?.[0]?.categoryName ?? "Unknown",
          lm: lm.map((p) => [+p.x.toFixed(4), +p.y.toFixed(4)]),
        }));
      }
      if (poseResult?.landmarks?.length) {
        const body = poseResult.landmarks[0];
        // Guard each index: a partially-visible body can leave arm landmarks
        // undefined, and the old code would have thrown into its catch. Here a
        // throw would abort the whole frame, so check instead of relying on it.
        if ([11, 12, 13, 14, 15, 16].every((i) => body[i])) {
          pose = [11, 12, 13, 14, 15, 16].map((i) => [+body[i].x.toFixed(4), +body[i].y.toFixed(4)]);
        }
      }
      if (hands || pose) {
        landmarkFramesRef.current.push({ t: frameT, hands, pose });
      }
    }

    // --- FPS + resolution overlay ---
    const frameNow = performance.now();
    const frames = fpsFramesRef.current;
    frames.push(frameNow);
    // Keep only last 1 second of frame timestamps
    while (frames.length > 0 && frames[0] < frameNow - 1000) frames.shift();
    const fps = frames.length;

    // Counter-flip the text so it reads correctly after the CSS scaleX(-1) mirror
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.font = "14px monospace";
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    const statsText = `${fps} FPS  ${w}×${h}`;
    const textWidth = ctx.measureText(statsText).width;
    ctx.fillRect(6, h - 28, textWidth + 12, 22);
    ctx.fillStyle = "#0f0";
    ctx.fillText(statsText, 12, h - 12);
    ctx.restore();

    // Throttle React state updates to ~4x/sec (every 250ms) to avoid
    // re-renders eating into the frame budget
    if (frameNow - lastStateUpdateRef.current > 250) {
      lastStateUpdateRef.current = frameNow;
      setFaults(activeFaults);
      setLiveEvents([
        ...wristSmootherRef.current.snapshot(lastTsRef.current),
        ...armSmootherRef.current.snapshot(lastTsRef.current),
      ]);
      setStats({ fps, width: w, height: h });
      setHandsDetected(frameHandsDetected);
      setPoseDetected(framePoseDetected);
      setShouldersDetected(frameShouldersDetected);
      setCurrentTs(lastTsRef.current);
    }
    rafIdRef.current = requestAnimationFrame(detectLoop);
  }, [videoRef, canvasRef]);

  // ---- skeleton replay buffer ----
  // The buffer is drained, never read in place: uploads happen in chunks during
  // the session AND once more at stop, and both paths must go through the same
  // take-and-clear primitive. Two readers with independent clears is how the
  // same frames end up uploaded twice under two chunk indices.
  const drainLandmarkFrames = useCallback(() => {
    const frames = landmarkFramesRef.current;
    landmarkFramesRef.current = [];
    return frames;
  }, []);

  // Called when recording actually starts (i.e. after camera framing is
  // confirmed and a backend session exists). start() opens the camera during the
  // framing phase, so without this the buffer would already hold frames that
  // belong to no session, and every `t` would be offset by however long the user
  // spent aiming the webcam. Re-zeroing here makes t=0 mean "recording started".
  // The smoothers must be cleared here too, not just in start(). The detect loop runs
  // throughout the framing phase, so without this a fault detected while the user was
  // still aiming the webcam is harvested at Stop and posted as session data — inflating
  // total_faults with posture the user never committed to, and (because
  // SessionDetail derives its time origin from the earliest fault) dragging the whole
  // replay timeline back before recording started.
  const beginLandmarkCapture = useCallback(() => {
    wristSmootherRef.current.clear();
    armSmootherRef.current.clear();
    setLiveEvents([]);
    landmarkFramesRef.current = [];
    lastSampleRef.current = 0;
    sessionStartRef.current = performance.now();
  }, []);

  // ---- start / stop ----
  const start = useCallback(async () => {
    await initModels();

    // Reset smoothing + fault log + skeleton capture
    wristSmootherRef.current.clear();
    armSmootherRef.current.clear();
    fpsFramesRef.current = [];
    lastTsRef.current = 0;
    landmarkFramesRef.current = [];
    lastSampleRef.current = 0;
    sessionStartRef.current = performance.now();
    setLiveEvents([]);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e) {
      setError(`Camera error: ${e.message}`);
      return;
    }

    rafIdRef.current = requestAnimationFrame(detectLoop);
  }, [initModels, detectLoop, videoRef]);

  const stop = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setFaults([]);
    setLiveEvents([]);

    // Finalize any still-open fault periods and harvest all periods
    const endMs = lastTsRef.current;
    wristSmootherRef.current.finalize(endMs);
    armSmootherRef.current.finalize(endMs);
    const events = [
      ...wristSmootherRef.current.harvest(),
      ...armSmootherRef.current.harvest(),
    ];
    // Whatever has not been uploaded yet — the caller flushes it as the final chunk.
    const landmarkFrames = drainLandmarkFrames();
    return { events, landmarkFrames };
  }, [videoRef, drainLandmarkFrames]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      handLandmarkerRef.current?.close();
      poseLandmarkerRef.current?.close();
    };
  }, []);

  return {
    isLoading, error, faults, liveEvents, stats,
    handsDetected, poseDetected, shouldersDetected, currentTs,
    start, stop, drainLandmarkFrames, beginLandmarkCapture,
  };
}
