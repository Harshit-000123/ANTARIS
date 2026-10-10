# ANTARIS System Overview

## Purpose
Provide a unified operational view for remote polar research stations where network access may be intermittent and logistics are constrained.

## Main dashboard areas
- **Mission Command:** station summary, key indicators, scenario status, telemetry trends, and alarm preview.
- **Telemetry:** environmental and equipment indicators with simulated live updates.
- **Offline Sync:** queue and connectivity-state concepts for deferred synchronization.
- **Resource Intelligence:** resource availability and operational risk indicators.
- **Logistics:** supplies and inventory-oriented records.
- **Crew & Assignments:** crew roles and station assignments.
- **Emergency:** scenario-based emergency status and priority information.
- **Audit / Event Log:** operational event history and severity.

## High-level architecture

```text
Browser UI (HTML + CSS + JavaScript)
             |
             | HTTP / JSON
             v
Node.js HTTP server (server.js)
             |
             v
SQLite persistence layer (database.js)
             |
             v
Local database file (data/antaris.db)
```

The interface is designed to remain usable as a simulation if the local API is unavailable. Actual sensor integration, identity management, production-grade security, backup procedures, and validated operational data feeds would need to be implemented before real-world use.

## Data flow
1. The dashboard initializes its station and scenario state.
2. The UI generates illustrative telemetry for demonstration.
3. When available, the API bridge sends supported telemetry, audit, logistics, crew, synchronization, or emergency records to the backend.
4. The backend validates basic request fields and persists records in SQLite.
5. API health can be checked at `/api/health`.

## Current limitations
- Sample values and scenario outputs are not verified live station readings.
- The local API is not a hardened production service.
- Authentication, role-based authorization, rate limiting, and a formal security review are not included.
- Real sensor gateways and external station systems are not configured by this package.
