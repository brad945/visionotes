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
  FaultSmoother,
} from "./faults";
import { drawHand, drawArms } from "./draw";

// CDN path for the WASM + model files MediaPipe needs at runtime
const VISION_WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

export default function useVision(videoRef, canvasRef) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [faults, setFaults] = useState([]); // current active fault labels
  const [stats, setStats] = useState({ fps: 0, width: 0, height: 0 });

  // Mutable refs that persist across renders without re-triggering them
  const handLandmarkerRef = useRef(null);
  const poseLandmarkerRef = useRef(null);
  const rafIdRef = useRef(null);
  const streamRef = useRef(null);
  const lastTsRef = useRef(0);
  const wristSmootherRef = useRef(new FaultSmoother());
  const armSmootherRef = useRef(new FaultSmoother());
  const faultEventsRef = useRef([]); // collected during a session for later batch-upload
  const fpsFramesRef = useRef([]); // timestamps of recent frames for FPS calc
  const lastStateUpdateRef = useRef(0); // throttle React state updates

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

    // --- Hands ---
    try {
      const handResult = handLandmarkerRef.current.detectForVideo(video, ts);
      if (handResult.landmarks && handResult.handedness) {
        for (let i = 0; i < handResult.landmarks.length; i++) {
          const lm = handResult.landmarks[i];
          // handedness label from MediaPipe is the hand's own label (mirrored in selfie view)
          const label = handResult.handedness[i]?.[0]?.categoryName ?? "Unknown";

          const collapsed = isWristCollapsed(lm);
          const faultIndices = new Set();
          const smoothed = wristSmootherRef.current.push(label, collapsed);

          if (smoothed) {
            for (const idx of WRIST_FAULT_INDICES) faultIndices.add(idx);
            activeFaults.push(`${label} wrist collapsed`);
            faultEventsRef.current.push({
              fault_type: "collapsed_wrist",
              hand: label.toLowerCase(),
              timestamp_ms: ts,
            });
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
      const poseResult = poseLandmarkerRef.current.detectForVideo(video, poseTs);
      if (poseResult.landmarks && poseResult.landmarks.length > 0) {
        const body = poseResult.landmarks[0];
        const faultArms = new Set();

        for (const side of ["left", "right"]) {
          const { fault } = checkArmPosture(body, side);
          const smoothed = armSmootherRef.current.push(side, fault);
          if (smoothed) {
            faultArms.add(side);
            activeFaults.push(`${side} arm posture`);
            faultEventsRef.current.push({
              fault_type: "arm_posture",
              hand: side,
              timestamp_ms: poseTs,
            });
          }
        }

        drawArms(ctx, body, w, h, faultArms);
      }
    } catch {
      // skip frame
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
      setStats({ fps, width: w, height: h });
    }
    rafIdRef.current = requestAnimationFrame(detectLoop);
  }, [videoRef, canvasRef]);

  // ---- start / stop ----
  const start = useCallback(async () => {
    await initModels();

    // Reset smoothing + fault log
    wristSmootherRef.current.clear();
    armSmootherRef.current.clear();
    faultEventsRef.current = [];
    fpsFramesRef.current = [];
    lastTsRef.current = 0;

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

    // Return collected fault events so caller can batch-upload them
    const events = faultEventsRef.current;
    faultEventsRef.current = [];
    return events;
  }, [videoRef]);

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

  return { isLoading, error, faults, stats, start, stop };
}
