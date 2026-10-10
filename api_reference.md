# ANTARIS API Reference

Base URL when running locally: `http://localhost:3000/api`

All request and response bodies use JSON unless otherwise noted.

## Health and station data
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | API and database health |
| GET | `/stations` | List station records |
| GET | `/stations/:station/telemetry` | Read recent telemetry for `bharati` or `maitri` |
| POST | `/telemetry` | Store a telemetry record |

## Operational records
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/packets/:station` | List synchronization packets |
| POST | `/packets` | Add a synchronization packet |
| POST | `/packets/flush` | Mark queued packets as synchronized |
| GET | `/audit/:station` | Read audit events |
| POST | `/audit` | Add an audit event |
| GET | `/logistics/:station` | Read logistics records |
| POST | `/logistics` | Add/update a logistics record |
| GET | `/crew/:station` | Read crew assignments |
| POST | `/crew` | Add a crew assignment |
| GET | `/emergency/:station` | Read emergency events |
| POST | `/emergency` | Add an emergency event |

`:station` must be `bharati` or `maitri`. For write requests, send `Content-Type: application/json` and include the fields required by the route. The server returns HTTP 400 for basic validation errors and HTTP 404 for unknown routes.

## Health-check example

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

Check `server.js` for the exact accepted fields and route-specific validation before integrating a client.
