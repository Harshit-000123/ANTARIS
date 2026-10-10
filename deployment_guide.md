# ANTARIS Local Setup and Deployment

## Local run on Windows
1. Install Node.js 22.5+.
2. Extract the project ZIP.
3. Open the extracted folder in VS Code.
4. Select **Terminal → New Terminal**.
5. Run `node --version` and confirm it is at least `v22.5.0`.
6. Run `npm start`.
7. Visit `http://localhost:3000/`.

Stop the server with `Ctrl+C`.

## Troubleshooting
- **`node` is not recognized:** install Node.js, reopen VS Code, and check `node --version`.
- **Port 3000 is busy:** set a different port before starting. In PowerShell: `$env:PORT=3001; npm start`, then open `http://localhost:3001/`.
- **Dashboard opens but API health fails:** confirm the server terminal has no startup error and use the same host and port for the page and API.
- **Database file:** the server creates `data/antaris.db` automatically. Keep the `data` directory on persistent storage if records must survive redeployments.

## Production checklist
Before any operational deployment:
- Add authentication and role-based access controls.
- Restrict CORS to approved origins.
- Add request size limits, rate limiting, input validation, and security logging.
- Configure HTTPS and secret management.
- Set up database backup, restore testing, retention, and monitoring.
- Connect only approved and authenticated sensor/data sources.
- Validate alarm thresholds with station experts.
- Label simulated data clearly and never treat demo output as operational truth.
- Perform accessibility, reliability, and security testing.
