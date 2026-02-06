// ═══════════════════════════════════════════════════════════
// server.js — Production-Ready (Render / Railway)
// ═══════════════════════════════════════════════════════════

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// ── CORS: Accept requests from your Vercel frontend ──
const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL || "http://localhost:5173",
  // Add your Vercel URLs here after deployment:
  // "https://ninjutsu-arena.vercel.app",
  // "https://your-custom-domain.com",
].filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin) || !origin) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
  // Production optimizations
  pingTimeout: 30000,
  pingInterval: 10000,
  transports: ["websocket", "polling"],
});

// ── JUTSUS DATABASE ──
const JUTSUS = [
  { id: "katon", name: "火遁・豪火球の術", signs: ["snake","ram","monkey","boar","horse","tiger"], damage: 35, chakraCost: 30, element: "fire" },
  { id: "chidori", name: "千鳥", signs: ["ox","hare","monkey"], damage: 45, chakraCost: 40, element: "lightning" },
  { id: "rasengan", name: "螺旋丸", signs: ["monkey","dragon","rat","bird","snake"], damage: 40, chakraCost: 35, element: "wind" },
  { id: "kage_bunshin", name: "影分身の術", signs: ["ram","snake","tiger"], damage: 20, chakraCost: 15, element: "neutral" },
  { id: "phoenix", name: "火遁・鳳仙火の術", signs: ["rat","tiger","dog","ox"], damage: 30, chakraCost: 25, element: "fire" },
  { id: "raikiri", name: "雷切", signs: ["ox","hare","monkey","dragon"], damage: 50, chakraCost: 50, element: "lightning" },
];

// ── ROOM MANAGEMENT ──
const rooms = new Map();
const playerRooms = new Map(); // socketId -> roomCode

function generateCode() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({length: 6}, () => c[Math.floor(Math.random()*c.length)]).join(""); }
  while (rooms.has(code));
  return code;
}

function newPlayer(name) {
  return { name, hp: 200, maxHp: 200, chakra: 100, maxChakra: 100, comboIndex: 0, signsCompleted: [], jutsusLanded: 0, totalDamage: 0, ready: false };
}

function pickJutsu() { return JUTSUS[Math.floor(Math.random() * JUTSUS.length)]; }

// ── SOCKET HANDLING ──
io.on("connection", (socket) => {
  console.log(`[+] ${socket.id} connected (${io.engine.clientsCount} total)`);

  socket.on("create_room", ({ playerName }, cb) => {
    const code = generateCode();
    rooms.set(code, {
      players: { [socket.id]: newPlayer(playerName || "Player 1") },
      host: socket.id,
      status: "waiting",
      round: 1,
      currentJutsu: null,
      timers: {},
    });
    playerRooms.set(socket.id, code);
    socket.join(code);
    console.log(`[ROOM] ${code} created by ${playerName}`);
    cb({ success: true, roomCode: code, playerId: socket.id });
  });

  socket.on("join_room", ({ roomCode, playerName }, cb) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb({ success: false, error: "Salon introuvable" });
    if (Object.keys(room.players).length >= 2) return cb({ success: false, error: "Salon complet" });

    room.players[socket.id] = newPlayer(playerName || "Player 2");
    playerRooms.set(socket.id, code);
    socket.join(code);
    console.log(`[ROOM] ${playerName} joined ${code}`);
    cb({ success: true, roomCode: code, playerId: socket.id });

    io.to(code).emit("room_update", {
      players: Object.entries(room.players).map(([id, p]) => ({ id, name: p.name, isHost: id === room.host })),
      status: room.status,
    });
  });

  socket.on("player_ready", () => {
    const code = playerRooms.get(socket.id);
    const room = code && rooms.get(code);
    if (!room?.players[socket.id]) return;

    room.players[socket.id].ready = true;
    io.to(code).emit("ready_update", {
      players: Object.entries(room.players).map(([id, p]) => ({ id, name: p.name, ready: p.ready })),
    });

    if (Object.values(room.players).every(p => p.ready) && Object.keys(room.players).length === 2) {
      startCountdown(code);
    }
  });

  socket.on("sign_detected", ({ sign }) => {
    const code = playerRooms.get(socket.id);
    const room = code && rooms.get(code);
    if (!room || room.status !== "playing") return;

    const player = room.players[socket.id];
    if (!player || !room.currentJutsu) return;

    const expected = room.currentJutsu.signs[player.comboIndex];
    if (sign === expected) {
      player.comboIndex++;
      player.signsCompleted.push(sign);

      io.to(code).emit("combo_progress", {
        playerId: socket.id, playerName: player.name,
        comboIndex: player.comboIndex, sign,
        total: room.currentJutsu.signs.length,
      });

      if (player.comboIndex >= room.currentJutsu.signs.length) {
        handleJutsuComplete(code, socket.id);
      }
    } else {
      socket.emit("wrong_sign", { expected, received: sign });
    }
  });

  socket.on("disconnect", () => {
    const code = playerRooms.get(socket.id);
    playerRooms.delete(socket.id);
    console.log(`[-] ${socket.id} disconnected`);

    if (code) {
      const room = rooms.get(code);
      if (room) {
        if (room.status === "playing") {
          const opponentId = Object.keys(room.players).find(id => id !== socket.id);
          if (opponentId) {
            io.to(code).emit("game_over", { winner: opponentId, reason: "disconnect" });
          }
        }
        Object.values(room.timers).forEach(t => clearTimeout(t));
        delete room.players[socket.id];
        if (Object.keys(room.players).length === 0) {
          rooms.delete(code);
          console.log(`[ROOM] ${code} deleted`);
        }
      }
    }
  });
});

// ── GAME FLOW ──
function startCountdown(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.status = "countdown";
  io.to(code).emit("countdown_start");

  let n = 3;
  const tick = () => {
    io.to(code).emit("countdown_tick", { count: n });
    if (n-- <= 0) return startRound(code);
    room.timers.countdown = setTimeout(tick, 1000);
  };
  tick();
}

function startRound(code) {
  const room = rooms.get(code);
  if (!room) return;

  room.currentJutsu = pickJutsu();
  room.status = "playing";
  Object.values(room.players).forEach(p => { p.comboIndex = 0; p.signsCompleted = []; });

  io.to(code).emit("round_start", {
    round: room.round,
    jutsu: { ...room.currentJutsu },
  });

  room.timers.turn = setTimeout(() => {
    io.to(code).emit("round_timeout");
    room.round++;
    startRound(code);
  }, 30000);
}

function handleJutsuComplete(code, winnerId) {
  const room = rooms.get(code);
  if (!room) return;
  room.status = "paused";
  clearTimeout(room.timers.turn);

  const winner = room.players[winnerId];
  const loserId = Object.keys(room.players).find(id => id !== winnerId);
  const loser = room.players[loserId];
  const jutsu = room.currentJutsu;

  loser.hp = Math.max(0, loser.hp - jutsu.damage);
  winner.chakra = Math.max(0, winner.chakra - jutsu.chakraCost);
  winner.jutsusLanded++;
  winner.totalDamage += jutsu.damage;
  Object.values(room.players).forEach(p => { p.chakra = Math.min(p.maxChakra, p.chakra + 15); });

  io.to(code).emit("jutsu_triggered", {
    attackerId: winnerId, attackerName: winner.name,
    targetId: loserId, targetName: loser.name,
    jutsu: { id: jutsu.id, name: jutsu.name, damage: jutsu.damage, element: jutsu.element },
    newState: { [winnerId]: { hp: winner.hp, chakra: winner.chakra }, [loserId]: { hp: loser.hp, chakra: loser.chakra } },
  });

  if (loser.hp <= 0) {
    room.timers.end = setTimeout(() => {
      room.status = "finished";
      io.to(code).emit("game_over", {
        winner: winnerId, winnerName: winner.name, reason: "ko",
        stats: Object.entries(room.players).map(([id, p]) => ({ id, name: p.name, hp: p.hp, jutsusLanded: p.jutsusLanded, totalDamage: p.totalDamage })),
      });
    }, 2500);
  } else {
    room.timers.next = setTimeout(() => { room.round++; startRound(code); }, 3000);
  }
}

// ── HEALTH CHECK ENDPOINT ──
app.get("/", (_, res) => res.json({
  service: "Ninjutsu Arena",
  status: "online",
  rooms: rooms.size,
  connections: io.engine.clientsCount,
  uptime: process.uptime(),
}));

app.get("/health", (_, res) => res.status(200).send("OK"));

// ── START ──
const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  忍 NINJUTSU ARENA SERVER\n  Port: ${PORT}\n  Status: ONLINE\n`);
});
