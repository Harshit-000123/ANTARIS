import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initDatabase,
  health,
  listStations,
  latestTelemetry,
  insertTelemetry,
  listPackets,
  insertPacket,
  flushPackets,
  listAudit,
  insertAudit,
  listLogistics,
  insertLogistics,
  listCrew,
  insertCrew,
  listEmergency,
  insertEmergency,
  closeDatabase,
  getDatabaseFile
} from './database.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const seed = {
  bharati: {temp:-34,chill:-37,rpm:1820,fuelRate:11.1,fuel:74,batt:82,load:63,water:88,o2:20.9},
  maitri: {temp:-39,chill:-41,rpm:1780,fuelRate:12.4,fuel:68,batt:74,load:71,water:81,o2:20.8}
};

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type',
    'Cache-Control':'no-store'
  });
  res.end(body);
}

function sendFile(res, fp) {
  const ext = path.extname(fp);
  const ct = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'}[ext] || 'application/octet-stream';
  res.writeHead(200, {'Content-Type':ct, 'Cache-Control':'no-cache'});
  res.end(fs.readFileSync(fp));
}

async function body(req) {
  let s='';
  for await (const chunk of req) s += chunk;
  if (!s) return {};
  try { return JSON.parse(s); } catch { throw new Error('Invalid JSON body'); }
}

function stationOk(s) { return s === 'bharati' || s === 'maitri'; }

async function router(req,res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;
  const method = req.method;

  if (method === 'OPTIONS') { res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}); return res.end(); }

  if (p === '/api/health' && method === 'GET') {
    const db = await health();
    return send(res,200,{ok:true,service:'ANTARIS API',database:db,time:Date.now()});
  }

  if (p === '/api/stations' && method === 'GET') return send(res,200,await listStations());

  let m;
  if ((m=p.match(/^\/api\/stations\/(bharati|maitri)\/telemetry$/)) && method==='GET') {
    const s=m[1], r=await latestTelemetry(s,seed[s]);
    return send(res,200,{...r.data,station:s,ts:r.ts,source:r.source});
  }

  if (p === '/api/telemetry' && method === 'GET') {
    const station = u.searchParams.get('station');
    if (!stationOk(station)) return send(res,400,{error:'valid station required'});
    const r=await latestTelemetry(station,seed[station]);
    return send(res,200,{...r.data,station,ts:r.ts,source:r.source});
  }

  if (p === '/api/telemetry' && method === 'POST') {
    const b=await body(req), s=b.station;
    if (!stationOk(s)) return send(res,400,{error:'station required'});
    const data={...b}; delete data.station;
    const r=await insertTelemetry(s,data);
    return send(res,201,{ok:true,...r});
  }

  if ((m=p.match(/^\/api\/sync\/queue\/(bharati|maitri)$/)) && method==='GET') return send(res,200,await listPackets(m[1]));

  if (p === '/api/sync/queue' && method === 'POST') {
    const b=await body(req);
    if (!stationOk(b.station) || b.payload === undefined) return send(res,400,{error:'station and payload required'});
    const r=await insertPacket(b.station,b.payload);
    await insertAudit(b.station,'Telemetry packet buffered','INFO');
    return send(res,201,{ok:true,...r});
  }

  if ((m=p.match(/^\/api\/sync\/(bharati|maitri)\/flush$/)) && method==='POST') {
    const s=m[1], r=await flushPackets(s);
    await insertAudit(s,`${r.synced} offline packets synchronized`,'SUCCESS');
    return send(res,200,{ok:true,...r});
  }

  if (p === '/api/audit' && method === 'GET') return send(res,200,await listAudit());
  if (p === '/api/audit' && method === 'POST') {
    const b=await body(req), s=stationOk(b.station)?b.station:'bharati';
    const r=await insertAudit(s,b.event||'Event',b.sev||'INFO');
    return send(res,201,{ok:true,...r});
  }

  if ((m=p.match(/^\/api\/logistics\/(bharati|maitri)$/)) && method==='GET') return send(res,200,await listLogistics(m[1]));
  if (p === '/api/logistics' && method==='POST') {
    const b=await body(req);
    if (!stationOk(b.station)||!b.item) return send(res,400,{error:'station and item required'});
    const r=await insertLogistics(b.station,b);
    await insertAudit(b.station,`Logistics item updated: ${b.item}`,'INFO');
    return send(res,201,r);
  }

  if ((m=p.match(/^\/api\/crew\/(bharati|maitri)$/)) && method==='GET') return send(res,200,await listCrew(m[1]));
  if (p === '/api/crew' && method==='POST') {
    const b=await body(req);
    if (!stationOk(b.station)||!b.code||!b.role) return send(res,400,{error:'station, code and role required'});
    const r=await insertCrew(b.station,b);
    await insertAudit(b.station,`Crew assignment updated: ${b.code}`,'INFO');
    return send(res,201,r);
  }

  if ((m=p.match(/^\/api\/emergency\/(bharati|maitri)$/)) && method==='GET') return send(res,200,await listEmergency(m[1]));
  if (p === '/api/emergency' && method==='POST') {
    const b=await body(req);
    if (!stationOk(b.station)) return send(res,400,{error:'station required'});
    const r=await insertEmergency(b.station,b);
    await insertAudit(b.station,`Emergency state: ${r.level} / ${r.scenario}`,r.level==='CRITICAL'?'CRITICAL':r.level==='NOMINAL'?'SUCCESS':'WARNING');
    return send(res,201,r);
  }

  if (method === 'GET') {
    const requested = p === '/' ? '/index.html' : p;
    const fp = path.normalize(path.join(publicDir,requested));
    if (fp.startsWith(publicDir) && fs.existsSync(fp) && fs.statSync(fp).isFile()) return sendFile(res,fp);
  }

  return send(res,404,{error:'Not found'});
}

const port=Number(process.env.PORT || 3000);

try {
  const migration = await initDatabase();
  const server=http.createServer((req,res)=>router(req,res).catch(err=>send(res,500,{error:err.message})));
  server.listen(port,()=>{
    console.log(`ANTARIS backend: http://localhost:${port}`);
    console.log(`SQLite database: ${getDatabaseFile()}`);
    if (migration.migrated) console.log('Migrated legacy antaris.json data into SQLite.');
  });
  const shutdown=async()=>{server.close(); await closeDatabase(); process.exit(0)};
  process.on('SIGINT',shutdown);
  process.on('SIGTERM',shutdown);
} catch (err) {
  console.error('ANTARIS startup failed:',err);
  process.exit(1);
}
