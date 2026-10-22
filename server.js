
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve the ArcadeHub website
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "ArcadeHub" });
});

// Demo rooms reset when the server restarts.
const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = Array.from(
      crypto.randomBytes(5),
      b => chars[b % chars.length]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function roomView(room) {
  return {
    code: room.code,
    gameId: room.gameId,
    intensity: room.intensity,
    status: room.status,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      score: p.score
    }))
  };
}

io.on("connection", socket => {
  socket.on("room:create", (data = {}, reply = () => {}) => {
    const code = makeCode();

    const room = {
      code,
      gameId: String(data.gameId || "click-rush").slice(0, 50),
      intensity: ["Chill", "Normal", "Intense"].includes(data.intensity)
        ? data.intensity
        : "Normal",
      status: "waiting",
      players: new Map()
    };

    room.players.set(socket.id, {
      id: socket.id,
      name: String(data.name || "Player 1").slice(0, 20),
      score: 0
    });

    rooms.set(code, room);
    socket.join(code);

    reply({ ok: true, room: roomView(room) });
    io.to(code).emit("room:update", roomView(room));
  });

  socket.on("room:join", (data = {}, reply = () => {}) => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return reply({
        ok: false,
        error: "Room not found. Check the code."
      });
    }

    if (room.status !== "waiting") {
      return reply({
        ok: false,
        error: "This game already started."
      });
    }

    if (room.players.size >= 2) {
      return reply({ ok: false, error: "Room is full." });
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: String(data.name || `Player ${room.players.size + 1}`).slice(0, 20),
      score: 0
    });

    socket.join(code);

    reply({ ok: true, room: roomView(room) });
    io.to(code).emit("room:update", roomView(room));
  });

  socket.on("room:start", (data = {}, reply = () => {}) => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room || !room.players.has(socket.id)) {
      return reply({
        ok: false,
        error: "You are not in this room."
      });
    }

    if (room.players.size < 2) {
      return reply({
        ok: false,
        error: "Wait for another player."
      });
    }

    if (room.status !== "waiting") {
      return reply({
        ok: false,
        error: "Game already started."
      });
    }

    room.status = "playing";

    io.to(code).emit("game:countdown", {
      seconds: 3,
      intensity: room.intensity,
      gameId: room.gameId
    });

    io.to(code).emit("room:update", roomView(room));
    reply({ ok: true });
  });

  socket.on("game:score", data => {
    const code = String(data?.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    const player = room?.players.get(socket.id);
    const score = Number(data?.score);

    if (
      !room ||
      room.status !== "playing" ||
      !player ||
      !Number.isFinite(score)
    ) {
      return;
    }

    player.score = Math.max(0, Math.min(1000000, Math.floor(score)));

    io.to(code).emit("room:update", roomView(room));
  });

  socket.on("game:finish", data => {
    const code = String(data?.code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (
      !room ||
      !room.players.has(socket.id) ||
      room.status !== "playing"
    ) {
      return;
    }

    room.status = "finished";

    io.to(code).emit("game:finished", roomView(room));
    io.to(code).emit("room:update", roomView(room));
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      if (!room.players.delete(socket.id)) continue;

      if (room.players.size === 0) {
        rooms.delete(code);
      } else {
        if (room.status === "playing") {
          room.status = "waiting";
        }

        io.to(code).emit("room:update", roomView(room));
        io.to(code).emit("room:notice", "A player disconnected.");
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ArcadeHub running on port ${PORT}`);
});
