import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = path.dirname(new URL(import.meta.url).pathname);
// Convert the file URL path safely on Windows/Linux without adding a dependency.
const projectRoot = process.platform === 'win32' ? decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/(?:\/)?/, '') : root;
const dataDir = path.join(projectRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbFile = path.join(dataDir, 'antaris.db');
const legacyFile = path.join(dataDir, 'antaris.json');

const db = new DatabaseSync(dbFile);

const uid = () => crypto.randomUUID();
const now = () => Date.now();

function run(sql, params = []) {
  const result = db.prepare(sql).run(...params);
  return {
    lastID: Number(result.lastInsertRowid ?? 0),
    changes: Number(result.changes ?? 0)
  };
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function exec(sql) {
  db.exec(sql);
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

async function initSchema() {
  await exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      short TEXT NOT NULL,
      nodes INTEGER NOT NULL,
      satcom TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telemetry (
      id TEXT PRIMARY KEY,
      station TEXT NOT NULL,
      ts INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      source TEXT,
      FOREIGN KEY (station) REFERENCES stations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_station_ts ON telemetry(station, ts DESC);

    CREATE TABLE IF NOT EXISTS sync_packets (
      id TEXT PRIMARY KEY,
      station TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      synced_at INTEGER,
      FOREIGN KEY (station) REFERENCES stations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sync_station_status ON sync_packets(station, status);

    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      station TEXT NOT NULL,
      event TEXT NOT NULL,
      sev TEXT NOT NULL DEFAULT 'INFO'
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC);

    CREATE TABLE IF NOT EXISTS logistics (
      id TEXT PRIMARY KEY,
      station TEXT NOT NULL,
      item TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (station) REFERENCES stations(id)
    );

    CREATE TABLE IF NOT EXISTS crew (
      id TEXT PRIMARY KEY,
      station TEXT NOT NULL,
      code TEXT NOT NULL,
      role TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (station) REFERENCES stations(id)
    );

    CREATE TABLE IF NOT EXISTS emergency (
      id TEXT PRIMARY KEY,
      station TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      level TEXT NOT NULL,
      scenario TEXT NOT NULL,
      details TEXT,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (station) REFERENCES stations(id)
    );
  `);
}

async function seedStations() {
  const stations = [
    ['bharati', 'BHARATI — Modern Edge', 'BHARATI', 124, 'DIRECT GSAT-7 KU-BAND LINK'],
    ['maitri', 'MAITRI — Legacy Grid', 'MAITRI', 28, 'DEGRADED INMARSAT-C · HIGH JITTER']
  ];
  for (const s of stations) {
    await run(
      `INSERT OR IGNORE INTO stations(id,label,short,nodes,satcom,created_at) VALUES(?,?,?,?,?,?)`,
      [...s, now()]
    );
  }
}

async function migrateLegacyJson() {
  if (!fs.existsSync(legacyFile)) return { migrated: false, reason: 'no legacy JSON' };

  const count = await get(`SELECT COUNT(*) AS n FROM telemetry`);
  const alreadyHasData = Number(count?.n || 0) > 0;
  if (alreadyHasData) return { migrated: false, reason: 'database already populated' };

  let legacy;
  try { legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8')); }
  catch { return { migrated: false, reason: 'legacy JSON unreadable' }; }

  await exec('BEGIN');
  try {
    for (const row of legacy.telemetry || []) {
      await run(
        `INSERT OR IGNORE INTO telemetry(id,station,ts,data_json,source) VALUES(?,?,?,?,?)`,
        [row.id || uid(), row.station, row.ts || now(), JSON.stringify(row.data || {}), row.source || 'legacy JSON']
      );
    }
    for (const row of legacy.packets || []) {
      await run(
        `INSERT OR IGNORE INTO sync_packets(id,station,created_at,payload_json,status,synced_at) VALUES(?,?,?,?,?,?)`,
        [row.id || uid(), row.station, row.created_at || now(), JSON.stringify(row.payload || {}), row.status || 'pending', row.synced_at || null]
      );
    }
    for (const row of legacy.audit || []) {
      await run(
        `INSERT OR IGNORE INTO audit(id,ts,station,event,sev) VALUES(?,?,?,?,?)`,
        [row.id || uid(), row.ts || now(), row.station || 'BHARATI', row.event || 'Legacy event', row.sev || 'INFO']
      );
    }
    for (const row of legacy.logistics || []) {
      const station = row.station;
      const item = row.item || 'Unknown item';
      await run(
        `INSERT OR IGNORE INTO logistics(id,station,item,payload_json,updated_at) VALUES(?,?,?,?,?)`,
        [row.id || uid(), station, item, JSON.stringify(row), row.updated_at || now()]
      );
    }
    for (const row of legacy.crew || []) {
      await run(
        `INSERT OR IGNORE INTO crew(id,station,code,role,payload_json,created_at) VALUES(?,?,?,?,?,?)`,
        [row.id || uid(), row.station, row.code || 'UNKNOWN', row.role || 'Unknown', JSON.stringify(row), row.created_at || now()]
      );
    }
    for (const row of legacy.emergency || []) {
      await run(
        `INSERT OR IGNORE INTO emergency(id,station,created_at,level,scenario,details,payload_json) VALUES(?,?,?,?,?,?,?)`,
        [row.id || uid(), row.station, row.created_at || now(), row.level || 'NOMINAL', row.scenario || 'normal', row.details || '', JSON.stringify(row)]
      );
    }
    await exec('COMMIT');
    return { migrated: true };
  } catch (err) {
    await exec('ROLLBACK').catch(() => {});
    throw err;
  }
}

export async function initDatabase() {
  await initSchema();
  await seedStations();
  return migrateLegacyJson();
}

export async function closeDatabase() {
  db.close();
}

export function getDatabaseFile() { return dbFile; }

export async function health() {
  const row = await get(`SELECT 1 AS ok`);
  return { ok: row?.ok === 1, engine: 'SQLite', file: path.relative(projectRoot, dbFile) };
}

export async function listStations() {
  return all(`SELECT id,label,short,nodes,satcom FROM stations ORDER BY id`);
}

export async function latestTelemetry(station, seed) {
  const row = await get(
    `SELECT id,station,ts,data_json,source FROM telemetry WHERE station=? ORDER BY ts DESC LIMIT 1`,
    [station]
  );
  if (!row) return { station, ts: now(), data: seed, source: 'prototype seed' };
  return { id: row.id, station: row.station, ts: row.ts, data: safeJson(row.data_json), source: row.source || 'ANTARIS backend' };
}

export async function insertTelemetry(station, data, source = 'ANTARIS frontend') {
  const row = { id: uid(), station, ts: now(), data };
  await run(`INSERT INTO telemetry(id,station,ts,data_json,source) VALUES(?,?,?,?,?)`, [row.id, station, row.ts, JSON.stringify(data), source]);
  await run(`DELETE FROM telemetry WHERE id NOT IN (SELECT id FROM telemetry ORDER BY ts DESC LIMIT 5000)`);
  return row;
}

export async function listPackets(station) {
  const rows = await all(`SELECT id,station,created_at,payload_json,status,synced_at FROM sync_packets WHERE station=? ORDER BY created_at DESC LIMIT 100`, [station]);
  const pending = rows.filter(r => r.status === 'pending').length;
  return {
    station,
    pending,
    packets: rows.map(r => ({ id:r.id, station:r.station, created_at:r.created_at, payload:safeJson(r.payload_json), status:r.status, synced_at:r.synced_at }))
  };
}

export async function insertPacket(station, payload) {
  const row = { id: uid(), station, created_at: now(), payload, status: 'pending' };
  await run(`INSERT INTO sync_packets(id,station,created_at,payload_json,status) VALUES(?,?,?,?,?)`, [row.id,station,row.created_at,JSON.stringify(payload),'pending']);
  return row;
}

export async function flushPackets(station) {
  const ts = now();
  const result = await run(`UPDATE sync_packets SET status='synced', synced_at=? WHERE station=? AND status='pending'`, [ts, station]);
  return { synced: result.changes, ts };
}

export async function listAudit() {
  return all(`SELECT id,ts,station,event,sev FROM audit ORDER BY ts DESC LIMIT 100`);
}

export async function insertAudit(station, event, sev='INFO') {
  const row = { id:uid(), ts:now(), station:station.toUpperCase(), event, sev };
  await run(`INSERT INTO audit(id,ts,station,event,sev) VALUES(?,?,?,?,?)`, [row.id,row.ts,row.station,row.event,row.sev]);
  await run(`DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY ts DESC LIMIT 500)`);
  return row;
}

export async function listLogistics(station) {
  const rows = await all(`SELECT id,station,item,payload_json,updated_at FROM logistics WHERE station=? ORDER BY updated_at DESC`, [station]);
  return rows.map(r => ({...safeJson(r.payload_json, {}), id:r.id, station:r.station, item:r.item, updated_at:r.updated_at}));
}

export async function insertLogistics(station, payload) {
  const row = { id:uid(), ...payload, station, updated_at:now() };
  await run(`INSERT INTO logistics(id,station,item,payload_json,updated_at) VALUES(?,?,?,?,?)`, [row.id,station,row.item,JSON.stringify(row),row.updated_at]);
  return row;
}

export async function listCrew(station) {
  const rows = await all(`SELECT id,station,code,role,payload_json,created_at FROM crew WHERE station=? ORDER BY created_at DESC`, [station]);
  return rows.map(r => ({...safeJson(r.payload_json, {}), id:r.id, station:r.station, code:r.code, role:r.role, created_at:r.created_at}));
}

export async function insertCrew(station, payload) {
  const row = { id:uid(), status:'ON DUTY', readiness:'READY', ...payload, station, created_at:now() };
  await run(`INSERT INTO crew(id,station,code,role,payload_json,created_at) VALUES(?,?,?,?,?,?)`, [row.id,station,row.code,row.role,JSON.stringify(row),row.created_at]);
  return row;
}

export async function listEmergency(station) {
  const rows = await all(`SELECT id,station,created_at,level,scenario,details,payload_json FROM emergency WHERE station=? ORDER BY created_at DESC LIMIT 50`, [station]);
  return rows.map(r => ({...safeJson(r.payload_json, {}), id:r.id,station:r.station,created_at:r.created_at,level:r.level,scenario:r.scenario,details:r.details}));
}

export async function insertEmergency(station, payload) {
  const row = { id:uid(), created_at:now(), level:'NOMINAL', scenario:'normal', details:'', ...payload, station };
  await run(`INSERT INTO emergency(id,station,created_at,level,scenario,details,payload_json) VALUES(?,?,?,?,?,?,?)`, [row.id,station,row.created_at,row.level,row.scenario,row.details,JSON.stringify(row)]);
  return row;
}
