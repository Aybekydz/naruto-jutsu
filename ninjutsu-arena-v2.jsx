import { useState, useEffect, useRef, useCallback } from "react";

// ════════════════════════════════════════════════════════════════
// 忍 NINJUTSU ARENA v2 — Strict Vectorial Classifier + Debug
// ════════════════════════════════════════════════════════════════

// ── LANDMARK INDICES ──
const LM = { WRIST:0, THUMB_CMC:1, THUMB_MCP:2, THUMB_IP:3, THUMB_TIP:4, INDEX_MCP:5, INDEX_PIP:6, INDEX_DIP:7, INDEX_TIP:8, MIDDLE_MCP:9, MIDDLE_PIP:10, MIDDLE_DIP:11, MIDDLE_TIP:12, RING_MCP:13, RING_PIP:14, RING_DIP:15, RING_TIP:16, PINKY_MCP:17, PINKY_PIP:18, PINKY_DIP:19, PINKY_TIP:20 };
const FINGERS = { thumb:[1,2,3,4], index:[5,6,7,8], middle:[9,10,11,12], ring:[13,14,15,16], pinky:[17,18,19,20] };

// ── VECTOR MATH ──
const dist3 = (a,b) => Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2+((a.z||0)-(b.z||0))**2);
const vec3 = (a,b) => ({x:b.x-a.x, y:b.y-a.y, z:(b.z||0)-(a.z||0)});
const mag = v => Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z)||1e-8;
const cosine = (a,b) => (a.x*b.x+a.y*b.y+a.z*b.z)/(mag(a)*mag(b));

// ── SIGN DEFINITIONS (12 signs, constraint-based) ──
const SIGN_DEFS = {
  tiger: {
    jp:"寅", fr:"Tigre", en:"Tiger",
    desc: "Index + majeur étendus et joints. Annulaire + auriculaire repliés. Pouces croisés.",
    fingers: { index:"extended", middle:"extended", ring:"curled", pinky:"curled" },
    constraints: [
      { type:"dist", a:8, b:12, op:"<", val:0.14, msg:"Index et majeur doivent se toucher", w:1.0 },
      { type:"ext", f:"index", want:"extended", msg:"Index doit être tendu", w:1.0 },
      { type:"ext", f:"middle", want:"extended", msg:"Majeur doit être tendu", w:1.0 },
      { type:"ext", f:"ring", want:"curled", msg:"Annulaire doit être replié", w:0.9 },
      { type:"ext", f:"pinky", want:"curled", msg:"Auriculaire doit être replié", w:0.9 },
    ],
    refVecs: { index:[0,-1], middle:[0,-1] }, // direction vectors (normalized, y-up inverted)
    threshold: 0.62, strict: 0.74,
  },
  snake: {
    jp:"巳", fr:"Serpent", en:"Snake",
    desc: "Tous les doigts étendus et serrés ensemble.",
    fingers: { index:"extended", middle:"extended", ring:"extended", pinky:"extended" },
    constraints: [
      { type:"ext", f:"index", want:"extended", msg:"Index doit être tendu", w:1.0 },
      { type:"ext", f:"middle", want:"extended", msg:"Majeur doit être tendu", w:1.0 },
      { type:"ext", f:"ring", want:"extended", msg:"Annulaire doit être tendu", w:1.0 },
      { type:"ext", f:"pinky", want:"extended", msg:"Auriculaire doit être tendu", w:1.0 },
      { type:"dist", a:8, b:12, op:"<", val:0.16, msg:"Doigts doivent être serrés", w:0.8 },
      { type:"dist", a:12, b:16, op:"<", val:0.16, msg:"Majeur-annulaire serrés", w:0.8 },
      { type:"dist", a:16, b:20, op:"<", val:0.16, msg:"Annulaire-auriculaire serrés", w:0.8 },
    ],
    threshold: 0.58, strict: 0.70,
  },
  ram: {
    jp:"未", fr:"Bélier", en:"Ram",
    desc: "Poing fermé. Tous les doigts repliés dans la paume.",
    fingers: { index:"curled", middle:"curled", ring:"curled", pinky:"curled" },
    constraints: [
      { type:"ext", f:"index", want:"curled", msg:"Index doit être replié", w:1.0 },
      { type:"ext", f:"middle", want:"curled", msg:"Majeur doit être replié", w:1.0 },
      { type:"ext", f:"ring", want:"curled", msg:"Annulaire doit être replié", w:1.0 },
      { type:"ext", f:"pinky", want:"curled", msg:"Auriculaire doit être replié", w:1.0 },
    ],
    threshold: 0.60, strict: 0.72,
  },
  ox: {
    jp:"丑", fr:"Bœuf", en:"Ox",
    desc: "Index tendu vers le haut. Tous les autres doigts repliés.",
    fingers: { index:"extended", middle:"curled", ring:"curled", pinky:"curled" },
    constraints: [
      { type:"ext", f:"index", want:"extended", msg:"Index doit être tendu", w:1.0 },
      { type:"ext", f:"middle", want:"curled", msg:"Majeur doit être replié", w:1.0 },
      { type:"ext", f:"ring", want:"curled", msg:"Annulaire doit être replié", w:0.9 },
      { type:"ext", f:"pinky", want:"curled", msg:"Auriculaire doit être replié", w:0.9 },
    ],
    threshold: 0.64, strict: 0.76,
  },
  hare: {
    jp:"卯", fr:"Lièvre", en:"Hare",
    desc: "Auriculaire étendu. Tous les autres doigts repliés.",
    fingers: { index:"curled", middle:"curled", ring:"curled", pinky:"extended" },
    constraints: [
      { type:"ext", f:"pinky", want:"extended", msg:"Auriculaire doit être tendu", w:1.0 },
      { type:"ext", f:"index", want:"curled", msg:"Index doit être replié", w:1.0 },
      { type:"ext", f:"middle", want:"curled", msg:"Majeur doit être replié", w:1.0 },
      { type:"ext", f:"ring", want:"curled", msg:"Annulaire doit être replié", w:0.9 },
    ],
    threshold: 0.64, strict: 0.76,
  },
  monkey: {
    jp:"申", fr:"Singe", en:"Monkey",
    desc: "Pouce appuyé contre le majeur. Index étendu. Annulaire/auriculaire repliés.",
    fingers: { index:"extended", middle:"half", ring:"curled", pinky:"curled" },
    constraints: [
      { type:"ext", f:"index", want:"extended", msg:"Index doit être tendu", w:1.0 },
      { type:"dist", a:4, b:12, op:"<", val:0.14, msg:"Pouce doit toucher le majeur", w:1.0 },
      { type:"ext", f:"ring", want:"curled", msg:"Annulaire doit être replié", w:0.8 },
      { type:"ext", f:"pinky", want:"curled", msg:"Auriculaire doit être replié", w:0.8 },
    ],
    threshold: 0.58, strict: 0.70,
  },
  boar: {
    jp:"亥", fr:"Sanglier", en:"Boar",
    desc: "Main ouverte, tous les doigts écartés au maximum.",
    fingers: { index:"extended", middle:"extended", ring:"extended", pinky:"extended" },
    constraints: [
      { type:"ext", f:"index", want:"extended", msg:"Index doit être tendu", w:1.0 },
      { type:"ext", f:"middle", want:"extended", msg:"Majeur doit être tendu", w:1.0 },
      { type:"ext", f:"ring", want:"extended", msg:"Annulaire doit être tendu", w:1.0 },
      { type:"ext", f:"pinky", want:"extended", msg:"Auriculaire doit être tendu", w:1.0 },
      { type:"dist", a:8, b:12, op:">", val:0.18, msg:"Doigts doivent être écartés", w:0.9 },
      { type:"dist", a:12, b:16, op:">", val:0.14, msg:"Majeur-annulaire écartés", w:0.8 },
    ],
    threshold: 0.56, strict: 0.68,
  },
  horse: {
    jp:"午", fr:"Cheval", en:"Horse",
    desc: "Index et majeur étendus et très proches (quasi joints). Annulaire/auriculaire repliés.",
    fingers: { index:"extended", middle:"extended", ring:"curled", pinky:"curled" },
    constraints: [
      { type:"ext", f:"index", want:"extended", msg:"Index doit être tendu", w:1.0 },
      { type:"ext", f:"middle", want:"extended", msg:"Majeur doit être tendu", w:0.8 },
      { type:"dist", a:8, b:12, op:"<", val:0.10, msg:"Index et majeur très proches", w:0.9 },
      { type:"ext", f:"ring", want:"curled", msg:"Annulaire doit être replié", w:0.7 },
      { type:"ext", f:"pinky", want:"curled", msg:"Auriculaire doit être replié", w:0.7 },
    ],
    threshold: 0.56, strict: 0.70,
  },
  dog: {
    jp:"戌", fr:"Chien", en:"Dog",
    desc: "Pouce levé vers le haut. Tous les autres doigts repliés.",
    fingers: { index:"curled", middle:"curled", ring:"curled", pinky:"curled" },
    constraints: [
      { type:"thumb_up", msg:"Pouce doit être levé", w:1.0 },
      { type:"ext", f:"index", want:"curled", msg:"Index doit être replié", w:1.0 },
      { type:"ext", f:"middle", want:"curled", msg:"Majeur doit être replié", w:1.0 },
      { type:"ext", f:"ring", want:"curled", msg:"Annulaire doit être replié", w:0.9 },
      { type:"ext", f:"pinky", want:"curled", msg:"Auriculaire doit être replié", w:0.9 },
    ],
    threshold: 0.62, strict: 0.74,
  },
  dragon: {
    jp:"辰", fr:"Dragon", en:"Dragon",
    desc: "Index, majeur et annulaire étendus. Auriculaire replié.",
    fingers: { index:"extended", middle:"extended", ring:"extended", pinky:"curled" },
    constraints: [
      { type:"ext", f:"index", want:"extended", msg:"Index doit être tendu", w:1.0 },
      { type:"ext", f:"middle", want:"extended", msg:"Majeur doit être tendu", w:1.0 },
      { type:"ext", f:"ring", want:"extended", msg:"Annulaire doit être tendu", w:1.0 },
      { type:"ext", f:"pinky", want:"curled", msg:"Auriculaire doit être replié", w:1.0 },
    ],
    threshold: 0.56, strict: 0.68,
  },
  rat: {
    jp:"子", fr:"Rat", en:"Rat",
    desc: "Index et majeur étendus en V. Annulaire et auriculaire repliés.",
    fingers: { index:"extended", middle:"extended", ring:"curled", pinky:"curled" },
    constraints: [
      { type:"ext", f:"index", want:"extended", msg:"Index doit être tendu", w:1.0 },
      { type:"ext", f:"middle", want:"extended", msg:"Majeur doit être tendu", w:1.0 },
      { type:"ext", f:"ring", want:"curled", msg:"Annulaire doit être replié", w:0.9 },
      { type:"ext", f:"pinky", want:"curled", msg:"Auriculaire doit être replié", w:0.9 },
      { type:"dist", a:8, b:12, op:"range", min:0.14, max:0.38, msg:"Index-majeur en V (écartés)", w:0.8 },
    ],
    threshold: 0.55, strict: 0.68,
  },
  bird: {
    jp:"酉", fr:"Oiseau", en:"Bird",
    desc: "Pouce et index se touchent (pince). Majeur, annulaire, auriculaire étendus.",
    fingers: { index:"pinch", middle:"extended", ring:"extended", pinky:"extended" },
    constraints: [
      { type:"dist", a:4, b:8, op:"<", val:0.11, msg:"Pouce et index doivent se toucher", w:1.0 },
      { type:"ext", f:"middle", want:"extended", msg:"Majeur doit être tendu", w:1.0 },
      { type:"ext", f:"ring", want:"extended", msg:"Annulaire doit être tendu", w:0.8 },
      { type:"ext", f:"pinky", want:"extended", msg:"Auriculaire doit être tendu", w:0.8 },
    ],
    threshold: 0.58, strict: 0.72,
  },
};

const SIGN_KEYS = Object.keys(SIGN_DEFS);

// ── NORMALIZE LANDMARKS ──
function normalize(raw) {
  const c = raw[LM.MIDDLE_MCP];
  const ps = dist3(raw[LM.WRIST], c) || 1e-8;
  return raw.map(p => ({ x:(p.x-c.x)/ps, y:(p.y-c.y)/ps, z:((p.z||0)-(c.z||0))/ps }));
}

// ── FINGER STATE ──
function fingerState(norm, finger) {
  const idx = FINGERS[finger];
  if (!idx) return { ext:false, curled:false, ratio:0 };
  const mcp=norm[idx[0]], pip=norm[idx[1]], tip=norm[idx[3]], w=norm[LM.WRIST];
  const tipD = dist3(tip,w), pipD = dist3(pip,w);
  const ext = tipD > pipD * 1.05;
  const tipMcp = dist3(tip, mcp), pipMcp = dist3(pip, mcp);
  const curl = pipMcp > 0 ? tipMcp/pipMcp : 0;
  return { ext, curled: !ext && curl < 1.2, ratio: tipD/(dist3(mcp,w)||1e-8), curl };
}

// ── CONSTRAINT EVALUATOR ──
function evalConstraint(c, norm) {
  const r = { pass:false, score:0, msg:c.msg, w:c.w||1, errJoints:[] };
  if (c.type === "ext") {
    const s = fingerState(norm, c.f);
    if (c.want === "extended") { r.pass = s.ext; r.score = s.ext ? Math.min(1, s.ratio/1.4) : s.ratio/2.5; }
    else { r.pass = s.curled; r.score = s.curled ? Math.min(1,(2-s.curl)/1.5) : (1-s.ratio)/2; }
    if (!r.pass) r.errJoints = [FINGERS[c.f]?.[3]].filter(Boolean);
  } else if (c.type === "dist") {
    const d = dist3(norm[c.a], norm[c.b]);
    if (c.op === "<") { r.pass = d < c.val; r.score = r.pass ? 1-d/c.val : Math.max(0,1-d/(c.val*2.5)); }
    else if (c.op === ">") { r.pass = d > c.val; r.score = r.pass ? Math.min(1,d/c.val-0.3) : d/c.val; }
    else if (c.op === "range") { r.pass = d>=c.min && d<=c.max; const mid=(c.min+c.max)/2, rng=(c.max-c.min)/2; r.score = r.pass ? 1-Math.abs(d-mid)/rng : 0.2; }
    if (!r.pass) r.errJoints = [c.a, c.b];
  } else if (c.type === "thumb_up") {
    const tip=norm[LM.THUMB_TIP], ip=norm[LM.THUMB_IP];
    r.pass = tip.y < ip.y - 0.05;
    r.score = r.pass ? 0.9 : 0.2;
    if (!r.pass) r.errJoints = [LM.THUMB_TIP];
  }
  return r;
}

// ── STRICT CLASSIFIER ──
function classifyStrict(raw, strictMode=false) {
  if (!raw || raw.length < 21) return null;
  const norm = normalize(raw);
  const results = [];

  for (const [key, def] of Object.entries(SIGN_DEFS)) {
    let cScore=0, cWeight=0;
    const cResults = [];
    const errJ = new Set(), errM = [];

    for (const c of def.constraints) {
      const r = evalConstraint(c, norm);
      cResults.push(r);
      cScore += r.score * r.w;
      cWeight += r.w;
      if (!r.pass) { r.errJoints.forEach(j => errJ.add(j)); errM.push(r.msg); }
    }
    const normCS = cWeight > 0 ? cScore/cWeight : 0;

    // Finger vector similarity bonus
    let vecSim = 0.5;
    const fKeys = ["index","middle","ring","pinky"];
    let vs=0, vw=0;
    for (const f of fKeys) {
      const idx = FINGERS[f];
      const uv = vec3(norm[idx[0]], norm[idx[3]]);
      // Compare to expected state
      const expected = def.fingers[f];
      if (expected === "extended") {
        const downVec = {x:0, y:-1, z:0};
        const sim = (cosine(uv, downVec)+1)/2;
        vs += sim; vw += 1;
      } else if (expected === "curled") {
        const palmVec = {x:0, y:0.3, z:0.5};
        const sim = (cosine(uv, palmVec)+1)/2;
        vs += sim * 0.7; vw += 0.7;
      }
    }
    vecSim = vw > 0 ? vs/vw : 0.5;

    const combined = normCS * 0.55 + vecSim * 0.45;
    results.push({ sign:key, score:Math.min(0.99, Math.max(0, combined)), cResults, errJoints:[...errJ], errMsgs:errM, normCS, vecSim });
  }

  results.sort((a,b) => b.score - a.score);
  const best = results[0];
  const def = SIGN_DEFS[best.sign];
  const thresh = strictMode ? def.strict : def.threshold;
  const gap = best.score - (results[1]?.score || 0);

  if (best.score < thresh || (gap < 0.06 && best.score < 0.78)) return { sign:null, debug: { candidates:results.slice(0,4), reason: best.score < thresh ? `Score ${(best.score*100).toFixed(0)}% < seuil ${(thresh*100).toFixed(0)}%` : `Ambigu: ${best.sign} vs ${results[1]?.sign}` }};

  return { sign:best.sign, confidence:best.score, debug:{ candidates:results.slice(0,4), match:best } };
}

// ── HAND SIGN SVG ILLUSTRATIONS ──
const HandSVG = ({ sign, size=56, highlight=false }) => {
  const s = SIGN_DEFS[sign];
  if (!s) return null;
  const col = highlight ? "#ffd700" : "#c4a97d";
  const dark = highlight ? "#b8860b" : "#8b7355";
  const patterns = {
    tiger: <g><rect x="20" y="28" width="24" height="14" rx="5" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="26" y="8" width="5" height="24" rx="2.5" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="33" y="8" width="5" height="24" rx="2.5" fill={col} stroke={dark} strokeWidth="1.2"/><line x1="28" y1="8" x2="36" y2="8" stroke="#c33" strokeWidth="1.5"/><rect x="14" y="32" width="5" height="8" rx="2" fill={col} stroke={dark} strokeWidth="1" transform="rotate(-10 16 36)"/></g>,
    snake: <g><rect x="14" y="22" width="13" height="20" rx="4" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="35" y="22" width="13" height="20" rx="4" fill={col} stroke={dark} strokeWidth="1.2" opacity="0.85"/>{[18,24,30,36,42].map((x,i)=><rect key={i} x={x-2} y={12} width="4" height="16" rx="2" fill={col} stroke={dark} strokeWidth="0.8" opacity="0.9"/>)}<path d="M20 30 Q31 26 42 30" fill="none" stroke="#4a4" strokeWidth="1.2"/></g>,
    ram: <g><rect x="18" y="22" width="28" height="18" rx="7" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="22" y="18" width="20" height="8" rx="4" fill={col} stroke={dark} strokeWidth="1"/><line x1="32" y1="26" x2="32" y2="36" stroke={dark} strokeWidth="1"/></g>,
    ox: <g><rect x="22" y="28" width="20" height="14" rx="5" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="29" y="8" width="6" height="24" rx="3" fill={col} stroke={dark} strokeWidth="1.2"/><line x1="22" y1="34" x2="42" y2="34" stroke={dark} strokeWidth="0.8"/></g>,
    hare: <g><rect x="20" y="26" width="22" height="16" rx="6" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="38" y="10" width="5" height="20" rx="2.5" fill={col} stroke={dark} strokeWidth="1.2"/><circle cx="32" cy="34" r="2.5" fill={dark}/></g>,
    monkey: <g><rect x="20" y="24" width="22" height="16" rx="5" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="24" y="10" width="5" height="18" rx="2.5" fill={col} stroke={dark} strokeWidth="1.2"/><ellipse cx="37" cy="26" rx="3.5" ry="5" fill={col} stroke={dark} strokeWidth="1"/><circle cx="34" cy="29" r="1.8" fill={dark}/></g>,
    boar: <g><rect x="16" y="26" width="32" height="12" rx="4" fill={col} stroke={dark} strokeWidth="1.2"/>{[20,26,32,38,44].map((x,i)=><rect key={i} x={x-2} y={14} width="4" height="16" rx="2" fill={col} stroke={dark} strokeWidth="0.8"/>)}</g>,
    horse: <g><path d="M32 8 L20 36 L44 36 Z" fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round"/><rect x="28" y="6" width="8" height="14" rx="3" fill={col} stroke={dark} strokeWidth="1"/><circle cx="32" cy="28" r="3.5" fill="none" stroke="#c90" strokeWidth="1.2"/></g>,
    dog: <g><rect x="20" y="26" width="24" height="16" rx="7" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="16" y="10" width="7" height="20" rx="3.5" fill={col} stroke={dark} strokeWidth="1.2"/><circle cx="19.5" cy="10" r="2.5" fill="#c90" stroke={dark} strokeWidth="0.8"/></g>,
    dragon: <g><rect x="18" y="26" width="28" height="14" rx="5" fill={col} stroke={dark} strokeWidth="1.2"/>{[23,30,37].map((x,i)=><rect key={i} x={x-2.5} y={10} width="5" height="20" rx="2.5" fill={col} stroke={dark} strokeWidth="1"/>)}<path d="M22 26 Q32 22 42 26" fill="none" stroke="#0cf" strokeWidth="1.2"/></g>,
    rat: <g><rect x="20" y="28" width="24" height="14" rx="5" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="24" y="8" width="5" height="24" rx="2.5" fill={col} stroke={dark} strokeWidth="1.2"/><rect x="35" y="8" width="5" height="24" rx="2.5" fill={col} stroke={dark} strokeWidth="1.2"/></g>,
    bird: <g><path d="M20 30 Q32 18 44 30" fill="none" stroke={col} strokeWidth="2.5"/><circle cx="24" cy="32" r="3.5" fill={col} stroke={dark} strokeWidth="1"/><circle cx="40" cy="32" r="3.5" fill={col} stroke={dark} strokeWidth="1"/><rect x="28" y="26" width="8" height="14" rx="3" fill={col} stroke={dark} strokeWidth="1"/><path d="M28 20 L32 14 L36 20" fill="none" stroke="#8bf" strokeWidth="1.2"/></g>,
  };
  return <svg width={size} height={size} viewBox="0 0 64 48" style={{filter:highlight?"drop-shadow(0 0 6px rgba(255,215,0,0.5))":"drop-shadow(0 1px 3px rgba(0,0,0,0.3))"}}>{patterns[sign]||<text x="32" y="28" textAnchor="middle" fill="#888" fontSize="12">{s.jp}</text>}</svg>;
};

// ── JUTSUS ──
const JUTSUS = [
  { name:"火遁・豪火球の術", fr:"Katon: Boule de Feu", signs:["snake","ram","monkey","boar","horse","tiger"], dmg:35, el:"fire", color:"#ff4500" },
  { name:"千鳥", fr:"Chidori", signs:["ox","hare","monkey"], dmg:45, el:"lightning", color:"#00bfff" },
  { name:"螺旋丸", fr:"Rasengan", signs:["monkey","dragon","rat","bird","snake"], dmg:40, el:"wind", color:"#00e5ff" },
  { name:"影分身の術", fr:"Multi-Clonage", signs:["ram","snake","tiger"], dmg:20, el:"neutral", color:"#aaa" },
  { name:"雷切", fr:"Raikiri", signs:["ox","hare","monkey","dragon"], dmg:50, el:"lightning", color:"#87ceeb" },
];

// ── CONNECTIONS ──
const CONNS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];

// ════════════════════════════
// MAIN COMPONENT
// ════════════════════════════
export default function NinjutsuArena() {
  const [screen, setScreen] = useState("title");
  const [debug, setDebug] = useState(true);
  const [strict, setStrict] = useState(false);
  const [detected, setDetected] = useState(null);
  const [debugData, setDebugData] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [announce, setAnnounce] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const handsRef = useRef(null);
  const holdRef = useRef({ sign:null, frames:0 });
  const gsRef = useRef(null);
  const HOLD = 10;

  useEffect(() => { gsRef.current = gameState; }, [gameState]);

  // Load MediaPipe
  useEffect(() => {
    if (typeof window === "undefined") return;
    ["https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.min.js"].forEach(src => {
      if (!document.querySelector(`script[src="${src}"]`)) {
        const s = document.createElement("script"); s.src = src; s.crossOrigin = "anonymous"; document.head.appendChild(s);
      }
    });
  }, []);

  const startCam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ width:640, height:480, facingMode:"user" }});
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      const waitForHands = () => new Promise(res => { const check = () => window.Hands ? res() : setTimeout(check, 100); check(); });
      await waitForHands();
      const hands = new window.Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}` });
      hands.setOptions({ maxNumHands:2, modelComplexity:1, minDetectionConfidence:0.6, minTrackingConfidence:0.5 });
      hands.onResults(onResults);
      handsRef.current = hands;
      const loop = async () => {
        if (videoRef.current?.readyState >= 2 && handsRef.current) await handsRef.current.send({ image: videoRef.current });
        if (streamRef.current) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch (e) { console.error("Cam:", e); }
  }, []);

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
    if (handsRef.current) { handsRef.current.close(); handsRef.current = null; }
  }, []);

  // ── HAND RESULTS ──
  const onResults = useCallback((results) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    cv.width = 640; cv.height = 480;
    ctx.clearRect(0, 0, 640, 480);

    if (!results.multiHandLandmarks?.length) {
      setDetected(null); setDebugData(null); holdRef.current = { sign:null, frames:0 };
      return;
    }

    const lm = results.multiHandLandmarks[0];
    const res = classifyStrict(lm, strict);
    const errSet = new Set(res?.debug?.match?.errJoints || []);

    // Draw skeleton with color coding
    for (const [a,b] of CONNS) {
      const aE = errSet.has(a), bE = errSet.has(b);
      ctx.beginPath();
      ctx.moveTo(lm[a].x*640, lm[a].y*480);
      ctx.lineTo(lm[b].x*640, lm[b].y*480);
      ctx.strokeStyle = (aE||bE) ? "#ff2020" : res?.sign ? "#20ff60" : "#ffa500";
      ctx.lineWidth = (aE||bE) ? 3 : 2;
      if (aE||bE) { ctx.setLineDash([4,3]); } else { ctx.setLineDash([]); }
      ctx.stroke(); ctx.setLineDash([]);
    }

    // Draw joints
    for (let i = 0; i < 21; i++) {
      const p = lm[i], x = p.x*640, y = p.y*480;
      const isErr = errSet.has(i);
      ctx.beginPath(); ctx.arc(x, y, isErr ? 6 : 3.5, 0, Math.PI*2);
      if (isErr) {
        ctx.fillStyle = "#ff2020"; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI*2);
        ctx.strokeStyle = "rgba(255,32,32,0.4)"; ctx.lineWidth = 2; ctx.stroke();
      } else {
        ctx.fillStyle = res?.sign ? "#20ff60" : "#ffd700"; ctx.fill();
      }
    }

    // Bounding box
    const xs = lm.map(l=>l.x*640), ys = lm.map(l=>l.y*480);
    const bx=Math.min(...xs)-18, by=Math.min(...ys)-35, bw=Math.max(...xs)-bx+18, bh=Math.max(...ys)-(by+35)+18;
    ctx.strokeStyle = res?.sign ? "#20ff60" : "#ffa500";
    ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);

    // Label
    if (res?.sign) {
      const def = SIGN_DEFS[res.sign];
      const lbl = `${def.jp} ${def.en} — ${(res.confidence*100).toFixed(0)}%`;
      ctx.font = "bold 13px monospace";
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(bx, by-20, tw+10, 18);
      ctx.fillStyle = "#20ff60"; ctx.fillText(lbl, bx+5, by-6);
    }

    // Error messages
    if (debug && res?.debug?.match?.errMsgs?.length) {
      ctx.font = "bold 10px monospace";
      res.debug.match.errMsgs.forEach((m, i) => {
        const ey = by+bh+18+i*15;
        const tw2 = ctx.measureText(`⚠ ${m}`).width;
        ctx.fillStyle = "rgba(60,0,0,0.85)"; ctx.fillRect(bx, ey-10, tw2+8, 14);
        ctx.fillStyle = "#ff4040"; ctx.fillText(`⚠ ${m}`, bx+4, ey);
      });
    }

    // Candidates panel
    if (debug && res?.debug?.candidates) {
      const px = 445, py = 8;
      ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(px, py, 190, 18 + res.debug.candidates.length*16);
      ctx.font = "bold 9px monospace"; ctx.fillStyle = "#666"; ctx.fillText("CANDIDATS", px+4, py+12);
      res.debug.candidates.forEach((c, i) => {
        const cy = py+26+i*16;
        const barW = c.score*110;
        const isTop = i===0 && c.score >= (SIGN_DEFS[c.sign]?.threshold||0.55);
        ctx.fillStyle = isTop ? "rgba(32,255,96,0.25)" : "rgba(255,165,0,0.1)";
        ctx.fillRect(px+4, cy-9, barW, 13);
        ctx.fillStyle = isTop ? "#20ff60" : "#999";
        ctx.fillText(`${SIGN_DEFS[c.sign]?.fr||c.sign}: ${(c.score*100).toFixed(0)}%`, px+6, cy);
      });
    }

    setDetected(res?.sign ? { sign:res.sign, confidence:res.confidence } : null);
    setDebugData(res?.debug || null);

    // Hold detection for game
    if (res?.sign) {
      if (res.sign === holdRef.current.sign) holdRef.current.frames++;
      else holdRef.current = { sign:res.sign, frames:1 };
      if (holdRef.current.frames === HOLD) onSignConfirmed(res.sign);
    } else {
      holdRef.current = { sign:null, frames:0 };
    }
  }, [strict, debug]);

  // ── GAME LOGIC ──
  const onSignConfirmed = useCallback((sign) => {
    const gs = gsRef.current;
    if (!gs || gs.over || gs.paused) return;
    const expected = gs.jutsu.signs[gs.combo];
    if (sign === expected) {
      setGameState(prev => {
        if (!prev) return prev;
        const next = {...prev, combo: prev.combo+1};
        if (next.combo >= next.jutsu.signs.length) {
          next.paused = true;
          setTimeout(() => triggerJutsu(), 100);
        }
        return next;
      });
    }
  }, []);

  const triggerJutsu = useCallback(() => {
    const gs = gsRef.current;
    if (!gs) return;
    setAnnounce({ name:gs.jutsu.name, fr:gs.jutsu.fr, color:gs.jutsu.color });
    setTimeout(() => {
      setGameState(prev => {
        if (!prev) return prev;
        const next = {...prev};
        next.opHp = Math.max(0, next.opHp - next.jutsu.dmg);
        next.round++;
        if (next.opHp <= 0) { next.over = true; }
        else { next.jutsu = JUTSUS[Math.floor(Math.random()*JUTSUS.length)]; next.combo = 0; next.paused = false; }
        return next;
      });
      setAnnounce(null);
    }, 2000);
  }, []);

  const startGame = useCallback(async () => {
    setGameState({ jutsu:JUTSUS[Math.floor(Math.random()*JUTSUS.length)], combo:0, hp:200, opHp:200, round:1, over:false, paused:false });
    setScreen("battle");
    await startCam();
  }, [startCam]);

  useEffect(() => () => stopCam(), [stopCam]);

  // Keyboard debug
  useEffect(() => {
    const h = (e) => {
      const map = {"1":"snake","2":"ram","3":"monkey","4":"boar","5":"horse","6":"tiger","7":"ox","8":"hare","9":"dragon","0":"rat","-":"bird","=":"dog"};
      if (map[e.key] && screen==="battle") onSignConfirmed(map[e.key]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [screen, onSignConfirmed]);

  // ════════ RENDER ════════
  const bg = { minHeight:"100vh", background:"#06060c", color:"#ddd", fontFamily:"'Segoe UI','Hiragino Sans',system-ui,sans-serif", position:"relative", overflow:"hidden" };
  const glow = { position:"fixed", inset:0, zIndex:0, pointerEvents:"none", background:"radial-gradient(ellipse at 25% 35%,rgba(255,69,0,0.04) 0%,transparent 50%),radial-gradient(ellipse at 75% 65%,rgba(0,191,255,0.04) 0%,transparent 50%)" };

  // ── TITLE ──
  if (screen === "title") return (
    <div style={bg}><div style={glow}/>
      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",gap:"1.2rem",padding:"2rem",textAlign:"center"}}>
        <div style={{fontSize:"clamp(5rem,16vw,12rem)",fontWeight:900,background:"linear-gradient(180deg,#ffd700,#ff4500 55%,#8b0000)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",lineHeight:1,filter:"drop-shadow(0 0 50px rgba(255,69,0,0.5))"}}>忍</div>
        <div style={{fontSize:"clamp(0.65rem,2vw,1.1rem)",letterSpacing:"0.6em",color:"#00bfff",textShadow:"0 0 15px rgba(0,191,255,0.4)"}}>NINJUTSU ARENA</div>
        <div style={{fontSize:"0.6rem",letterSpacing:"0.3em",opacity:0.3}}>STRICT VECTORIAL CLASSIFIER v2</div>
        <div style={{display:"flex",flexDirection:"column",gap:"0.7rem",marginTop:"1.5rem",width:"100%",maxWidth:320}}>
          {[
            {l:"VS CPU",c:"#ff4500",fn:()=>startGame()},
            {l:"ENTRAÎNEMENT + DEBUG",c:"#ffd700",fn:()=>{setScreen("training");startCam();}},
          ].map(({l,c,fn})=>(
            <button key={l} onClick={fn} style={{fontFamily:"inherit",fontSize:"0.8rem",fontWeight:700,padding:"0.85rem 1.5rem",border:`1.5px solid ${c}`,borderRadius:"3px",cursor:"pointer",background:"transparent",color:c,letterSpacing:"0.12em",transition:"all 0.3s"}}
              onMouseEnter={e=>{e.target.style.background=c;e.target.style.color="#06060c";}} onMouseLeave={e=>{e.target.style.background="transparent";e.target.style.color=c;}}>
              {l}
            </button>
          ))}
        </div>
        <div style={{display:"flex",gap:"2rem",marginTop:"2rem",flexWrap:"wrap",justifyContent:"center"}}>
          {SIGN_KEYS.map(k => <div key={k} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"0.2rem",opacity:0.5}}>
            <HandSVG sign={k} size={36}/><span style={{fontSize:"0.4rem",letterSpacing:"0.05em"}}>{SIGN_DEFS[k].jp} {SIGN_DEFS[k].en}</span>
          </div>)}
        </div>
        <div style={{fontSize:"0.5rem",opacity:0.2,marginTop:"1rem"}}>CLAVIER DEBUG: 1=Snake 2=Ram 3=Monkey 4=Boar 5=Horse 6=Tiger 7=Ox 8=Hare 9=Dragon 0=Rat -=Bird ==Dog</div>
      </div>
    </div>
  );

  // ── TRAINING ──
  if (screen === "training") return (
    <div style={bg}>
      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",height:"100vh"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.6rem 1rem",background:"#0a0a10f0",borderBottom:"1px solid #ffffff08",flexShrink:0}}>
          <button onClick={()=>{stopCam();setScreen("title");}} style={{background:"transparent",border:"1px solid #fff2",color:"#fff6",padding:"0.35rem 0.8rem",borderRadius:"3px",cursor:"pointer",fontFamily:"inherit",fontSize:"0.6rem"}}>← RETOUR</button>
          <span style={{fontSize:"0.75rem",color:"#ffd700",letterSpacing:"0.25em",fontWeight:700}}>DOJO — DEBUG CALIBRATION</span>
          <div style={{display:"flex",gap:"0.5rem"}}>
            <label style={{fontSize:"0.55rem",display:"flex",alignItems:"center",gap:"0.3rem",cursor:"pointer",opacity:0.7}}>
              <input type="checkbox" checked={debug} onChange={e=>setDebug(e.target.checked)}/> Debug
            </label>
            <label style={{fontSize:"0.55rem",display:"flex",alignItems:"center",gap:"0.3rem",cursor:"pointer",opacity:0.7}}>
              <input type="checkbox" checked={strict} onChange={e=>setStrict(e.target.checked)}/> Strict
            </label>
          </div>
        </div>
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          <div style={{flex:1,position:"relative",background:"#000"}}>
            <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)"}} autoPlay playsInline muted/>
            <canvas ref={canvasRef} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)"}}/>
            {detected && <div style={{position:"absolute",top:12,left:"50%",transform:"translateX(-50%)",background:"#000c",padding:"0.5rem 1.2rem",borderRadius:6,border:"1px solid #20ff6060",zIndex:10,textAlign:"center"}}>
              <div style={{fontSize:"1.4rem",fontWeight:900,color:"#20ff60"}}>{SIGN_DEFS[detected.sign]?.jp} {SIGN_DEFS[detected.sign]?.fr}</div>
              <div style={{fontSize:"0.65rem",color:"#20ff60",opacity:0.7}}>Confiance: {(detected.confidence*100).toFixed(0)}%{strict?" [STRICT]":""}</div>
            </div>}
            {!detected && debugData?.reason && <div style={{position:"absolute",top:12,left:"50%",transform:"translateX(-50%)",background:"#000c",padding:"0.4rem 1rem",borderRadius:6,border:"1px solid #ffa50040",zIndex:10}}>
              <div style={{fontSize:"0.65rem",color:"#ffa500"}}>{debugData.reason}</div>
            </div>}
          </div>
          <div style={{width:280,background:"#0c0c14",padding:"0.8rem",overflowY:"auto",borderLeft:"1px solid #ffffff08",flexShrink:0}}>
            <div style={{fontSize:"0.6rem",color:"#ffd700",letterSpacing:"0.2em",marginBottom:"0.8rem",fontWeight:700}}>12 SCEAUX — GUIDE</div>
            {SIGN_KEYS.map(k => {
              const active = detected?.sign === k;
              return <div key={k} style={{display:"flex",gap:"0.6rem",alignItems:"center",padding:"0.5rem",marginBottom:"0.4rem",background:active?"#20ff6010":"#14141e",borderRadius:5,border:active?"1px solid #20ff6040":"1px solid #ffffff06",transition:"all 0.3s"}}>
                <HandSVG sign={k} size={40} highlight={active}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:"0.65rem",fontWeight:700,color:active?"#20ff60":"#ffd700"}}>{SIGN_DEFS[k].jp} {SIGN_DEFS[k].en}</div>
                  <div style={{fontSize:"0.48rem",opacity:0.45,lineHeight:1.4,marginTop:2}}>{SIGN_DEFS[k].desc}</div>
                </div>
              </div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // ── BATTLE ──
  if (screen === "battle" && gameState) {
    const gs = gameState;
    const jutsu = gs.jutsu;
    if (gs.over) return (
      <div style={bg}><div style={glow}/>
        <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",gap:"1.5rem",textAlign:"center"}}>
          <div style={{fontSize:"clamp(2rem,5vw,4rem)",fontWeight:900,color:"#ffd700",textShadow:"0 0 40px rgba(255,215,0,0.5)"}}>VICTOIRE !</div>
          <div style={{fontSize:"1rem",opacity:0.6}}>Round {gs.round} — HP restants: {gs.hp}</div>
          <div style={{display:"flex",gap:"0.8rem",marginTop:"1rem"}}>
            <button onClick={()=>{stopCam();startGame();}} style={{padding:"0.7rem 1.5rem",background:"#ff4500",color:"#06060c",border:"none",borderRadius:3,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>REVANCHE</button>
            <button onClick={()=>{stopCam();setScreen("title");}} style={{padding:"0.7rem 1.5rem",background:"transparent",border:"1.5px solid #ffd700",color:"#ffd700",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontWeight:700}}>MENU</button>
          </div>
        </div>
      </div>
    );

    return (
      <div style={bg}>
        <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",height:"100vh"}}>
          {/* Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.5rem 1rem",background:"#0a0a10f5",borderBottom:"1px solid #ffffff08",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:"0.6rem"}}>
              <span style={{fontSize:"0.7rem",fontWeight:700,color:"#ff4500"}}>VOUS</span>
              <div style={{width:180,height:14,background:"#1a1a2e",borderRadius:2,overflow:"hidden",border:"1px solid #ffffff10",position:"relative"}}>
                <div style={{height:"100%",width:`${(gs.hp/200)*100}%`,background:"linear-gradient(90deg,#8b0000,#ff4500)",transition:"width 0.5s"}}/>
                <span style={{position:"absolute",right:4,top:"50%",transform:"translateY(-50%)",fontSize:"0.45rem",fontWeight:700,color:"#fff",textShadow:"0 1px 2px #000"}}>{gs.hp}/200</span>
              </div>
            </div>
            <span style={{fontSize:"0.6rem",color:"#ffd700",letterSpacing:"0.2em",fontWeight:700}}>R{gs.round}</span>
            <div style={{display:"flex",alignItems:"center",gap:"0.6rem",flexDirection:"row-reverse"}}>
              <span style={{fontSize:"0.7rem",fontWeight:700,color:"#00bfff"}}>CPU</span>
              <div style={{width:180,height:14,background:"#1a1a2e",borderRadius:2,overflow:"hidden",border:"1px solid #ffffff10",position:"relative"}}>
                <div style={{height:"100%",width:`${(gs.opHp/200)*100}%`,background:"linear-gradient(90deg,#003366,#00bfff)",transition:"width 0.5s"}}/>
                <span style={{position:"absolute",right:4,top:"50%",transform:"translateY(-50%)",fontSize:"0.45rem",fontWeight:700,color:"#fff",textShadow:"0 1px 2px #000"}}>{gs.opHp}/200</span>
              </div>
            </div>
          </div>

          {/* Jutsu bar */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.8rem",padding:"0.4rem",background:"#08080ff0",borderBottom:"1px solid #ffffff05",flexShrink:0}}>
            <span style={{fontSize:"0.5rem",opacity:0.4,letterSpacing:"0.15em"}}>JUTSU</span>
            <span style={{fontSize:"0.8rem",fontWeight:700,color:jutsu.color}}>{jutsu.name}</span>
            <span style={{fontSize:"0.5rem",opacity:0.35}}>{jutsu.fr} — DMG:{jutsu.dmg}</span>
          </div>

          {/* Arena */}
          <div style={{flex:1,display:"flex",position:"relative",overflow:"hidden"}}>
            <div style={{flex:1,position:"relative",background:"#000"}}>
              <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)"}} autoPlay playsInline muted/>
              <canvas ref={canvasRef} style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",objectFit:"cover",transform:"scaleX(-1)"}}/>
              {gs.combo < jutsu.signs.length && !gs.paused && (
                <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:10,display:"flex",alignItems:"center",gap:"0.5rem",background:"#000c",padding:"0.4rem 0.8rem",borderRadius:6,border:"1px solid #ffd70050"}}>
                  <HandSVG sign={jutsu.signs[gs.combo]} size={38} highlight/>
                  <div>
                    <div style={{fontSize:"0.5rem",opacity:0.5}}>PROCHAIN</div>
                    <div style={{fontSize:"0.9rem",fontWeight:900,color:"#ffd700"}}>{SIGN_DEFS[jutsu.signs[gs.combo]]?.jp} {SIGN_DEFS[jutsu.signs[gs.combo]]?.en}</div>
                  </div>
                </div>
              )}
            </div>
            <div style={{width:3,background:"linear-gradient(transparent,#ffd700,transparent)",position:"relative",zIndex:20}}>
              <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",fontSize:"0.55rem",fontWeight:900,color:"#ffd700",background:"#06060c",padding:"0.3rem",border:"1px solid #ffd700",borderRadius:"50%",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center"}}>VS</div>
            </div>
            <div style={{flex:1,background:"#0a0a12",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div style={{textAlign:"center",opacity:0.25}}>
                <div style={{fontSize:"4rem"}}>🥷</div>
                <div style={{fontSize:"0.7rem",letterSpacing:"0.1em"}}>CPU NINJA</div>
              </div>
            </div>
          </div>

          {/* Combo strip */}
          <div style={{padding:"0.5rem 0.8rem",background:"#08080ff5",borderTop:"1px solid #ffffff08",flexShrink:0}}>
            <div style={{display:"flex",gap:"0.3rem",justifyContent:"center",flexWrap:"wrap"}}>
              {jutsu.signs.map((s, i) => {
                const done = i < gs.combo, active = i === gs.combo;
                return <div key={i} style={{width:48,height:48,borderRadius:4,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",border:done?"2px solid #228b22":active?"2px solid #ffd700":"1.5px solid #ffffff12",background:done?"#228b2218":active?"#ffd70012":"#ffffff04",boxShadow:active?"0 0 10px #ffd70030":"none",transition:"all 0.3s",position:"relative"}}>
                  <HandSVG sign={s} size={30} highlight={active}/>
                  <div style={{fontSize:"0.35rem",opacity:done?0.8:active?1:0.3,color:done?"#228b22":active?"#ffd700":"#888",marginTop:1}}>{SIGN_DEFS[s]?.en}</div>
                  {done && <div style={{position:"absolute",fontSize:"0.7rem",color:"#228b22",fontWeight:900}}>✓</div>}
                </div>;
              })}
            </div>
          </div>

          <button onClick={()=>{stopCam();setScreen("title");}} style={{position:"absolute",top:56,left:6,zIndex:50,background:"#000a",border:"1px solid #fff2",color:"#fff5",padding:"0.25rem 0.5rem",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:"0.5rem"}}>✕</button>
        </div>

        {announce && <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",background:"#000b",pointerEvents:"none"}}>
          <div style={{textAlign:"center",animation:"jutsuZ 2s ease forwards"}}>
            <div style={{fontSize:"clamp(2rem,6vw,5rem)",fontWeight:900,color:announce.color,textShadow:`0 0 50px ${announce.color}80`}}>{announce.name}</div>
            <div style={{fontSize:"clamp(0.7rem,1.5vw,1.1rem)",color:"#fffc",marginTop:"0.4rem",letterSpacing:"0.2em"}}>{announce.fr}</div>
          </div>
        </div>}
        <style>{`@keyframes jutsuZ{0%{transform:scale(0);opacity:0}15%{transform:scale(1.2);opacity:1}25%{transform:scale(1)}75%{opacity:1}100%{transform:scale(1.3);opacity:0}}`}</style>
      </div>
    );
  }

  return <div style={bg}><div style={{padding:"3rem",textAlign:"center",opacity:0.3}}>Chargement...</div></div>;
}
