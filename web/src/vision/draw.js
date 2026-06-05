/**
 * Canvas drawing utilities for hand/pose landmarks.
 * Colors the specific faulting joints red instead of a whole-frame border.
 */

// Hand skeleton connections (same as spike)
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

// Pose arm connections
const ARM_CONNECTIONS = [
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
];

/**
 * Draw hand landmarks on a canvas.
 * faultIndices: Set of landmark indices that are faulting (drawn red).
 */
export function drawHand(ctx, landmarks, w, h, faultIndices) {
  const pts = landmarks.map((lm) => [lm.x * w, lm.y * h]);

  // Lines
  ctx.lineWidth = 2;
  for (const [a, b] of HAND_CONNECTIONS) {
    const aFault = faultIndices.has(a);
    const bFault = faultIndices.has(b);
    ctx.strokeStyle = aFault && bFault ? "#ff3333" : "#00cc44";
    ctx.beginPath();
    ctx.moveTo(pts[a][0], pts[a][1]);
    ctx.lineTo(pts[b][0], pts[b][1]);
    ctx.stroke();
  }

  // Points
  for (let i = 0; i < pts.length; i++) {
    ctx.fillStyle = faultIndices.has(i) ? "#ff0000" : "#0066ff";
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw pose arm landmarks on a canvas.
 * faultArms: Set of 'left' | 'right' that are faulting.
 */
export function drawArms(ctx, poseLandmarks, w, h, faultArms) {
  const pts = poseLandmarks.map((lm) => [lm.x * w, lm.y * h]);

  const leftIndices = new Set([11, 13, 15]);
  const rightIndices = new Set([12, 14, 16]);

  // Lines
  ctx.lineWidth = 2;
  for (const [a, b] of ARM_CONNECTIONS) {
    const isLeft = leftIndices.has(a) && leftIndices.has(b);
    const isRight = rightIndices.has(a) && rightIndices.has(b);
    const fault =
      (isLeft && faultArms.has("left")) ||
      (isRight && faultArms.has("right"));
    ctx.strokeStyle = fault ? "#ff3333" : "#ffcc00";
    ctx.beginPath();
    ctx.moveTo(pts[a][0], pts[a][1]);
    ctx.lineTo(pts[b][0], pts[b][1]);
    ctx.stroke();
  }

  // Points (only arm-relevant ones)
  const armPts = [11, 12, 13, 14, 15, 16];
  for (const i of armPts) {
    const isLeft = leftIndices.has(i);
    const fault =
      (isLeft && faultArms.has("left")) ||
      (!isLeft && faultArms.has("right"));
    ctx.fillStyle = fault ? "#ff0000" : "#ff8800";
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
