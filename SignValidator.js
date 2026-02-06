// ═══════════════════════════════════════════════════════════════
// SignValidator.js — Strict Vectorial Hand Sign Classification
// ═══════════════════════════════════════════════════════════════
//
// Replaces heuristic if/else with:
//   1. Geometric normalization (translation + scale invariant)
//   2. Per-constraint weighted validation
//   3. Cosine similarity on finger direction vectors
//   4. Weighted Euclidean distance against reference landmarks
//   5. Debug overlay with per-joint error coloring
//

import refSignsData from "./ref_signs.json";

// ── LANDMARK INDICES ──
const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

const FINGER_LANDMARKS = {
  thumb:  [LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP],
  index:  [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  middle: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  ring:   [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  pinky:  [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
};

// ── VECTOR MATH ──
function vec3(a, b) {
  return { x: b.x - a.x, y: b.y - a.y, z: (b.z || 0) - (a.z || 0) };
}

function magnitude(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalize(v) {
  const m = magnitude(v) || 1e-8;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function distance3D(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function cosineSimilarity(a, b) {
  const d = dot(a, b);
  const ma = magnitude(a) || 1e-8;
  const mb = magnitude(b) || 1e-8;
  return d / (ma * mb);
}

function angleBetweenDeg(a, b) {
  const cos = Math.max(-1, Math.min(1, cosineSimilarity(a, b)));
  return Math.acos(cos) * (180 / Math.PI);
}

// ── NORMALIZATION ──
// Translate so palm center (MIDDLE_MCP) = origin, scale by palm size
function normalizeLandmarks(rawLandmarks) {
  const lm = rawLandmarks.map(p => ({ x: p.x, y: p.y, z: p.z || 0 }));
  const center = lm[LM.MIDDLE_MCP];
  const palmSize = distance3D(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-8;

  return lm.map(p => ({
    x: (p.x - center.x) / palmSize,
    y: (p.y - center.y) / palmSize,
    z: (p.z - center.z) / palmSize,
  }));
}

// ── FINGER STATE ANALYSIS ──
function getFingerExtension(normalized, finger) {
  const indices = FINGER_LANDMARKS[finger];
  if (!indices) return { extended: false, ratio: 0 };

  const mcp = normalized[indices[0]];
  const pip = normalized[indices[1]];
  const tip = normalized[indices[3]];
  const wrist = normalized[LM.WRIST];

  // Extension ratio: how far tip is from wrist compared to mcp
  const tipDist = distance3D(tip, wrist);
  const mcpDist = distance3D(mcp, wrist);

  // Curl ratio: tip-to-mcp vs pip-to-mcp
  const tipToMcp = distance3D(tip, mcp);
  const pipToMcp = distance3D(pip, mcp);

  // Direction check: tip should be farther from wrist than pip for extension
  const tipFromWrist = distance3D(tip, wrist);
  const pipFromWrist = distance3D(pip, wrist);

  const extensionRatio = mcpDist > 0 ? tipDist / mcpDist : 0;
  const isExtended = tipFromWrist > pipFromWrist * 1.05;
  const curlRatio = pipToMcp > 0 ? tipToMcp / pipToMcp : 0;

  return {
    extended: isExtended,
    curled: !isExtended && curlRatio < 1.2,
    extensionRatio,
    curlRatio,
    tipDist,
    mcpDist,
  };
}

function getThumbState(normalized) {
  const tip = normalized[LM.THUMB_TIP];
  const ip = normalized[LM.THUMB_IP];
  const mcp = normalized[LM.THUMB_MCP];
  const wrist = normalized[LM.WRIST];

  const isUp = tip.y < ip.y - 0.05;
  const tipDist = distance3D(tip, wrist);
  const mcpDist = distance3D(mcp, wrist);

  return {
    up: isUp,
    extended: tipDist > mcpDist * 0.9,
    curled: tipDist < mcpDist * 0.7,
  };
}

// ── CONSTRAINT VALIDATOR ──
function validateConstraint(constraint, normalized) {
  const result = { passed: false, score: 0, message: constraint.label, weight: constraint.weight || 1.0, errorJoints: [] };

  switch (constraint.type) {
    case "extension": {
      const state = getFingerExtension(normalized, constraint.finger);
      if (constraint.relation === "extended") {
        result.passed = state.extended;
        result.score = state.extended ? Math.min(1, state.extensionRatio / 1.5) : state.extensionRatio / 2;
        if (!result.passed) {
          const indices = FINGER_LANDMARKS[constraint.finger];
          result.errorJoints = indices ? [indices[3]] : [];
        }
      } else if (constraint.relation === "curled") {
        result.passed = state.curled;
        result.score = state.curled ? Math.min(1, (2 - state.curlRatio) / 1.5) : (1 - state.extensionRatio / 2);
        if (!result.passed) {
          const indices = FINGER_LANDMARKS[constraint.finger];
          result.errorJoints = indices ? [indices[2], indices[3]] : [];
        }
      }
      break;
    }

    case "distance": {
      const [a, b] = constraint.landmarks;
      const dist = distance3D(normalized[a], normalized[b]);

      if (constraint.relation === "less_than") {
        result.passed = dist < constraint.threshold;
        result.score = result.passed ? 1 - (dist / constraint.threshold) : Math.max(0, 1 - (dist / (constraint.threshold * 2)));
        if (!result.passed) result.errorJoints = [a, b];
      } else if (constraint.relation === "greater_than") {
        result.passed = dist > constraint.threshold;
        result.score = result.passed ? Math.min(1, dist / constraint.threshold - 0.5) : dist / constraint.threshold;
        if (!result.passed) result.errorJoints = [a, b];
      } else if (constraint.relation === "range") {
        result.passed = dist >= constraint.min && dist <= constraint.max;
        if (result.passed) {
          const mid = (constraint.min + constraint.max) / 2;
          const range = (constraint.max - constraint.min) / 2;
          result.score = 1 - Math.abs(dist - mid) / range;
        } else {
          result.score = 0.2;
          result.errorJoints = [a, b];
        }
      }
      break;
    }

    case "thumb_up": {
      const state = getThumbState(normalized);
      result.passed = state.up;
      result.score = state.up ? 0.9 : 0.2;
      if (!result.passed) result.errorJoints = [LM.THUMB_TIP, LM.THUMB_IP];
      break;
    }

    case "curl_depth": {
      const state = getFingerExtension(normalized, constraint.finger);
      result.passed = state.curlRatio <= (constraint.min_ratio || 0.8);
      result.score = result.passed ? 0.9 : Math.max(0, 1 - state.curlRatio);
      if (!result.passed) {
        const indices = FINGER_LANDMARKS[constraint.finger];
        result.errorJoints = indices ? [indices[3]] : [];
      }
      break;
    }

    case "isolation": {
      // Check that the specified finger tip is far from adjacent finger tips
      const fingerTips = { index: 8, middle: 12, ring: 16, pinky: 20 };
      const tipIdx = fingerTips[constraint.finger];
      if (tipIdx) {
        const adjacents = Object.entries(fingerTips)
          .filter(([name]) => name !== constraint.finger)
          .map(([, idx]) => distance3D(normalized[tipIdx], normalized[idx]));
        const minDist = Math.min(...adjacents);
        result.passed = minDist >= (constraint.min_gap || 0.15);
        result.score = result.passed ? Math.min(1, minDist / 0.3) : minDist / (constraint.min_gap || 0.15);
        if (!result.passed) result.errorJoints = [tipIdx];
      }
      break;
    }

    default:
      result.passed = true;
      result.score = 0.5;
  }

  return result;
}

// ── COSINE SIMILARITY ON FINGER VECTORS ──
function computeFingerVectorSimilarity(normalized, refLandmarks) {
  const fingers = ["index", "middle", "ring", "pinky"];
  let totalSim = 0;
  let totalWeight = 0;

  for (const finger of fingers) {
    const indices = FINGER_LANDMARKS[finger];
    const mcpIdx = indices[0];
    const tipIdx = indices[3];

    const userVec = vec3(normalized[mcpIdx], normalized[tipIdx]);
    const refVec = vec3(refLandmarks[mcpIdx], refLandmarks[tipIdx]);

    const sim = cosineSimilarity(userVec, refVec);
    const clampedSim = (sim + 1) / 2; // map [-1,1] to [0,1]

    totalSim += clampedSim;
    totalWeight += 1;
  }

  // Thumb vector
  const thumbUser = vec3(normalized[LM.THUMB_MCP], normalized[LM.THUMB_TIP]);
  const thumbRef = vec3(refLandmarks[LM.THUMB_MCP], refLandmarks[LM.THUMB_TIP]);
  const thumbSim = (cosineSimilarity(thumbUser, thumbRef) + 1) / 2;
  totalSim += thumbSim * 0.6;
  totalWeight += 0.6;

  return totalSim / totalWeight;
}

// ── WEIGHTED EUCLIDEAN DISTANCE ──
function computeWeightedEuclidean(normalized, refLandmarks) {
  // Weight tips more heavily than base joints
  const weights = [
    0.3,  // 0 wrist
    0.2, 0.3, 0.5, 0.8,  // thumb
    0.3, 0.5, 0.7, 1.0,  // index
    0.3, 0.5, 0.7, 1.0,  // middle
    0.3, 0.5, 0.7, 1.0,  // ring
    0.3, 0.5, 0.7, 1.0,  // pinky
  ];

  let totalDist = 0;
  let totalWeight = 0;
  const perJointError = [];

  for (let i = 0; i < 21; i++) {
    const d = distance3D(normalized[i], refLandmarks[i]);
    const w = weights[i];
    totalDist += d * w;
    totalWeight += w;
    perJointError.push({ index: i, distance: d, weight: w, weightedError: d * w });
  }

  const avgDist = totalDist / totalWeight;
  // Convert distance to similarity score (0-1), tuned so 0.3 avg dist ≈ 0.5 score
  const similarity = Math.max(0, 1 - avgDist / 0.6);

  return { similarity, avgDist, perJointError };
}

// ═══════════════════════════════════════
// MAIN VALIDATOR CLASS
// ═══════════════════════════════════════
export class SignValidator {
  constructor(referenceData = null) {
    this.signs = (referenceData || refSignsData).signs;
    this.debugMode = false;
    this.strictMode = false;
    this.lastDebugInfo = null;
  }

  setDebugMode(enabled) { this.debugMode = enabled; }
  setStrictMode(enabled) { this.strictMode = enabled; }

  /**
   * Classify a hand sign from raw MediaPipe landmarks.
   * Returns: { sign, confidence, debugInfo } or null
   */
  classify(rawLandmarks) {
    if (!rawLandmarks || rawLandmarks.length < 21) return null;

    const normalized = normalizeLandmarks(rawLandmarks);
    const results = [];

    for (const [signKey, signDef] of Object.entries(this.signs)) {
      const evaluation = this.evaluateSign(normalized, signKey, signDef);
      results.push({ sign: signKey, ...evaluation });
    }

    // Sort by combined score (descending)
    results.sort((a, b) => b.combinedScore - a.combinedScore);

    const best = results[0];
    const threshold = this.strictMode
      ? (this.signs[best.sign]?.strict_threshold || 0.75)
      : (this.signs[best.sign]?.min_confidence || 0.55);

    // Ambiguity check: if top two are very close, reject
    const secondBest = results[1];
    const ambiguityGap = best.combinedScore - (secondBest?.combinedScore || 0);

    if (best.combinedScore < threshold) {
      this.lastDebugInfo = this.debugMode ? {
        detectedSign: null,
        topCandidates: results.slice(0, 3),
        normalized,
        reason: `Score trop bas: ${(best.combinedScore * 100).toFixed(1)}% < ${(threshold * 100).toFixed(1)}%`,
      } : null;
      return null;
    }

    if (ambiguityGap < 0.08 && best.combinedScore < 0.8) {
      this.lastDebugInfo = this.debugMode ? {
        detectedSign: null,
        topCandidates: results.slice(0, 3),
        normalized,
        reason: `Ambigu: ${best.sign} (${(best.combinedScore*100).toFixed(1)}%) vs ${secondBest.sign} (${(secondBest.combinedScore*100).toFixed(1)}%)`,
      } : null;
      return null;
    }

    this.lastDebugInfo = this.debugMode ? {
      detectedSign: best.sign,
      confidence: best.combinedScore,
      topCandidates: results.slice(0, 3),
      constraintResults: best.constraintResults,
      vectorSimilarity: best.vectorSimilarity,
      euclideanSimilarity: best.euclideanSimilarity,
      errorJoints: best.errorJoints,
      errorMessages: best.errorMessages,
      normalized,
    } : null;

    return {
      sign: best.sign,
      confidence: best.combinedScore,
      debugInfo: this.lastDebugInfo,
    };
  }

  evaluateSign(normalized, signKey, signDef) {
    // 1. Constraint validation (40% of score)
    const constraintResults = [];
    let constraintScore = 0;
    let constraintWeight = 0;
    const errorJoints = new Set();
    const errorMessages = [];

    for (const constraint of (signDef.constraints || [])) {
      const result = validateConstraint(constraint, normalized);
      constraintResults.push(result);
      constraintScore += result.score * result.weight;
      constraintWeight += result.weight;

      if (!result.passed) {
        result.errorJoints.forEach(j => errorJoints.add(j));
        errorMessages.push(result.message);
      }
    }
    const normalizedConstraintScore = constraintWeight > 0 ? constraintScore / constraintWeight : 0;

    // 2. Cosine similarity on finger vectors (30% of score)
    const refLandmarks = signDef.reference_landmarks;
    const vectorSimilarity = refLandmarks
      ? computeFingerVectorSimilarity(normalized, refLandmarks)
      : 0.5;

    // 3. Weighted Euclidean distance (30% of score)
    const euclidean = refLandmarks
      ? computeWeightedEuclidean(normalized, refLandmarks)
      : { similarity: 0.5, perJointError: [] };

    // Combined score
    const combinedScore =
      normalizedConstraintScore * 0.45 +
      vectorSimilarity * 0.30 +
      euclidean.similarity * 0.25;

    return {
      combinedScore: Math.max(0, Math.min(1, combinedScore)),
      constraintScore: normalizedConstraintScore,
      vectorSimilarity,
      euclideanSimilarity: euclidean.similarity,
      constraintResults,
      errorJoints: [...errorJoints],
      errorMessages,
      perJointError: euclidean.perJointError,
    };
  }

  getDebugInfo() {
    return this.lastDebugInfo;
  }
}

// ═══════════════════════════════════════
// DEBUG OVERLAY RENDERER
// ═══════════════════════════════════════
export class DebugOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  /**
   * Draw the hand skeleton with per-joint coloring and error labels.
   * @param {Array} rawLandmarks - Original MediaPipe landmarks (0-1 range)
   * @param {Object} debugInfo - From SignValidator.classify()
   * @param {number} videoWidth
   * @param {number} videoHeight
   */
  draw(rawLandmarks, debugInfo, videoWidth = 640, videoHeight = 480) {
    const ctx = this.ctx;
    this.canvas.width = videoWidth;
    this.canvas.height = videoHeight;
    ctx.clearRect(0, 0, videoWidth, videoHeight);

    if (!rawLandmarks || rawLandmarks.length < 21) return;

    const errorSet = new Set(debugInfo?.errorJoints || []);

    // Connections
    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],
      [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20],
      [5,9],[9,13],[13,17],
    ];

    // Draw connections
    for (const [a, b] of connections) {
      const aErr = errorSet.has(a);
      const bErr = errorSet.has(b);
      const la = rawLandmarks[a];
      const lb = rawLandmarks[b];

      ctx.beginPath();
      ctx.moveTo(la.x * videoWidth, la.y * videoHeight);
      ctx.lineTo(lb.x * videoWidth, lb.y * videoHeight);

      if (aErr || bErr) {
        ctx.strokeStyle = "#ff2020";
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 3]);
      } else {
        ctx.strokeStyle = debugInfo?.detectedSign ? "#20ff60" : "#ffa500";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw joints
    for (let i = 0; i < rawLandmarks.length; i++) {
      const lm = rawLandmarks[i];
      const x = lm.x * videoWidth;
      const y = lm.y * videoHeight;
      const isError = errorSet.has(i);
      const perJoint = debugInfo?.perJointError?.[i];

      // Joint circle
      ctx.beginPath();
      ctx.arc(x, y, isError ? 6 : 4, 0, Math.PI * 2);

      if (isError) {
        ctx.fillStyle = "#ff2020";
        ctx.strokeStyle = "#ff6060";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        // Error pulse ring
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 32, 32, 0.4)";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // Color based on accuracy (green = good, yellow = ok)
        const error = perJoint ? perJoint.distance : 0;
        const hue = Math.max(0, 120 - error * 400); // 120=green, 0=red
        ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
        ctx.fill();
      }
    }

    // Bounding box
    const xs = rawLandmarks.map(l => l.x * videoWidth);
    const ys = rawLandmarks.map(l => l.y * videoHeight);
    const boxX = Math.min(...xs) - 20;
    const boxY = Math.min(...ys) - 40;
    const boxW = Math.max(...xs) - boxX + 20;
    const boxH = Math.max(...ys) - boxY + 20;

    ctx.strokeStyle = debugInfo?.detectedSign ? "#20ff60" : "#ffa500";
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // Sign label
    if (debugInfo?.detectedSign) {
      const signDef = refSignsData.signs[debugInfo.detectedSign];
      const label = `${signDef?.name_jp || debugInfo.detectedSign} — ${(debugInfo.confidence * 100).toFixed(0)}%`;

      ctx.font = "bold 14px 'Courier New', monospace";
      const textW = ctx.measureText(label).width;

      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(boxX, boxY - 22, textW + 10, 20);

      ctx.fillStyle = "#20ff60";
      ctx.fillText(label, boxX + 5, boxY - 7);
    } else if (debugInfo?.reason) {
      ctx.font = "bold 11px 'Courier New', monospace";
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(boxX, boxY - 22, ctx.measureText(debugInfo.reason).width + 10, 20);
      ctx.fillStyle = "#ffa500";
      ctx.fillText(debugInfo.reason, boxX + 5, boxY - 7);
    }

    // Error labels on failed joints
    if (debugInfo?.errorMessages?.length > 0) {
      const startY = boxY + boxH + 20;
      ctx.font = "bold 11px 'Courier New', monospace";

      debugInfo.errorMessages.forEach((msg, i) => {
        const y = startY + i * 16;
        const textW = ctx.measureText(`⚠ ${msg}`).width;

        ctx.fillStyle = "rgba(80, 0, 0, 0.8)";
        ctx.fillRect(boxX, y - 11, textW + 10, 15);

        ctx.fillStyle = "#ff4040";
        ctx.fillText(`⚠ ${msg}`, boxX + 5, y);
      });
    }

    // Top candidates panel (top-right)
    if (debugInfo?.topCandidates) {
      const panelX = videoWidth - 200;
      const panelY = 10;

      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(panelX, panelY, 190, 20 + debugInfo.topCandidates.length * 18);

      ctx.font = "bold 10px 'Courier New', monospace";
      ctx.fillStyle = "#888";
      ctx.fillText("CANDIDATS", panelX + 5, panelY + 13);

      debugInfo.topCandidates.forEach((c, i) => {
        const y = panelY + 30 + i * 18;
        const pct = (c.combinedScore * 100).toFixed(1);
        const signDef = refSignsData.signs[c.sign];
        const name = signDef?.name_fr || c.sign;

        // Score bar
        const barW = c.combinedScore * 100;
        const isTop = i === 0 && c.combinedScore >= (signDef?.min_confidence || 0.55);
        ctx.fillStyle = isTop ? "rgba(32, 255, 96, 0.3)" : "rgba(255, 165, 0, 0.15)";
        ctx.fillRect(panelX + 5, y - 10, barW, 14);

        ctx.fillStyle = isTop ? "#20ff60" : "#ccc";
        ctx.fillText(`${name}: ${pct}%`, panelX + 8, y);
      });
    }

    // Constraint detail panel (bottom-right)
    if (debugInfo?.constraintResults) {
      const cr = debugInfo.constraintResults;
      const panelX = videoWidth - 200;
      const panelY = videoHeight - 15 - cr.length * 14;

      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(panelX, panelY - 5, 190, cr.length * 14 + 10);

      ctx.font = "9px 'Courier New', monospace";
      cr.forEach((c, i) => {
        const y = panelY + 8 + i * 14;
        ctx.fillStyle = c.passed ? "#20ff60" : "#ff4040";
        ctx.fillText(`${c.passed ? "✓" : "✗"} ${c.message.substring(0, 28)}`, panelX + 4, y);
      });
    }
  }
}

// ── SINGLETON EXPORT ──
const validator = new SignValidator();
export default validator;
