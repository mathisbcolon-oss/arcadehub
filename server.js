
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
app.use(express.json({ limit: "10kb" }));
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


app.get("/api/leaderboard", async (_req, res) => {
  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/leaderboard?select=player_name,game_id,score,created_at&order=score.desc&limit=100`,
      {
        headers: {
          apikey: process.env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`
        }
      }
    );

    if (!response.ok) {
      console.error("Leaderboard read failed:", await response.text());
      return res.status(502).json({ error: "Could not load leaderboard." });
    }

    res.json(await response.json());
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ error: "Server error." });
  }
});

app.post("/api/score", async (req, res) => {
  try {
    const { player_name, game_id, score } = req.body || {};

    if (
      typeof player_name !== "string" ||
      player_name.trim().length < 1 ||
      player_name.trim().length > 20 ||
      typeof game_id !== "string" ||
      game_id.length < 1 ||
      game_id.length > 50 ||
      !Number.isSafeInteger(score) ||
      score < 0 ||
      score > 1000000
    ) {
      return res.status(400).json({ error: "Invalid score data." });
    }

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/leaderboard`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          player_name: player_name.trim(),
          game_id,
          score
        })
      }
    );

    if (!response.ok) {
      console.error("Score save failed:", await response.text());
      return res.status(502).json({ error: "Could not save score." });
    }

    res.status(201).json({ ok: true, score: (await response.json())[0] });
  } catch (error) {
    console.error("Score save error:", error);
    res.status(500).json({ error: "Server error." });
  }
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
