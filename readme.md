# ANTARIS — Polar Station Operations

ANTARIS is an offline-first dashboard concept for Antarctic research-station operations. It brings station telemetry, resource intelligence, logistics, crew assignments, emergency scenarios, offline synchronization, and audit history into one interface.

## Requirements
- Node.js 22.5 or newer (uses the built-in `node:sqlite` module)
- A modern desktop or mobile browser

## Run locally in VS Code
1. Extract this ZIP to a folder.
2. Open that folder in VS Code.
3. Open **Terminal → New Terminal**.
4. Run `npm start`.
5. Open `http://localhost:3000/` in your browser.
6. Optional: open `http://localhost:3000/api/health` to check the backend and database.

No separate `npm install` is required for the current dependency-free backend.

## Project structure
- `server.js` — HTTP server and REST API routes
- `database.js` — SQLite schema and persistence helpers
- `public/index.html` — dashboard structure and page metadata
- `public/style.css` — dashboard styling
- `public/GOLU_SONI_logic.js` — dashboard behaviour, simulated telemetry, and API bridge
- `data/antaris.db` — generated automatically when the backend starts

## Important data note
The interface includes simulated telemetry and scenario controls for demonstration. Treat dashboard values as illustrative unless connected to verified station sensors and authorized operational data. The backend can store supported records in a local SQLite database; this package does not itself connect to physical station equipment.

## Deployment note
This package is configured for a Node.js server. A static-only host can serve the frontend but will not run the Node/SQLite API. For persistent API features, deploy to a Node.js-capable service with persistent disk storage and configure the port through the `PORT` environment variable.
