# ArcadeHub

Browser arcade starter with an Express server and a Socket.IO multiplayer-room backend.

## Run locally
1. Install Node.js 20 or newer from https://nodejs.org/
2. Open a terminal in this folder.
3. Run `npm install`
4. Run `npm start`
5. Visit http://localhost:3000

Health check: http://localhost:3000/health

## Files
- `public/index.html` — arcade frontend prototype
- `server.js` — Express and Socket.IO multiplayer backend starter
- `package.json` — dependencies and scripts

## Multiplayer status
The server supports `room:create`, `room:join`, `room:start`, `game:score`, and `game:finish`, and emits `room:update`, `game:countdown`, `game:finished`, and `room:notice`.

The frontend is not yet connected to these Socket.IO events, so real multiplayer UI integration is still needed. Rooms are stored in memory and reset when the server restarts. Game screens/intensity settings are currently prototype placeholders.

## Before public launch
- Connect the frontend multiplayer controls to Socket.IO.
- Implement actual game mechanics and Chill / Normal / Intense tuning.
- Add persistent storage for accounts and online leaderboards.
- Secure the owner dashboard with authentication.
- Add server-side score validation and anti-cheat protections.
- Add privacy and moderation features.
- Ad placements are placeholders only. An ad network needs approval and account setup; a parent or guardian may need to manage advertising/payment accounts for an owner under 18.
