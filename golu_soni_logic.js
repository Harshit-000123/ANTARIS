/* ============================================================
   STATE
   ============================================================ */
const STATIONS = {
  bharati:{
    label:'BHARATI — Modern Edge', short:'BHARATI', nodes:124, nodeProtocol:'124 ACTIVE TELEMETRY NODES',
    satcom:'DIRECT GSAT-7 KU-BAND LINK', satcomShort:'SATCOM NOMINAL',
    jitter:0.35, retryChance:0.05, syncStep:0.34, queueGrowth:[1,2],
  },
  maitri:{
    label:'MAITRI — Legacy Grid', short:'MAITRI', nodes:28, nodeProtocol:'28 MODBUS NODES + CHECKPOINT BUFFER',
    satcom:'DEGRADED INMARSAT-C · HIGH JITTER', satcomShort:'SATCOM DEGRADED',
    jitter:1.9, retryChance:0.32, syncStep:0.16, queueGrowth:[2,5],
  },
};
const SCENARIOS = [
  {id:'normal', label:'Normal Operation'},
  {id:'connectivity_loss', label:'Connectivity Loss'},
  {id:'extreme_cold', label:'Extreme Cold'},
  {id:'generator_stress', label:'Generator Stress'},
  {id:'emergency', label:'Emergency Mode'},
];
const NAV = [
  {id:'command', label:'Mission Command', icon:'M3 12h4l3-9 4 18 3-9h4'},
  {id:'telemetry', label:'Telemetry', icon:'M4 19V6M9 19V10M14 19V4M19 19V13'},
  {id:'sync', label:'Offline Sync', icon:'M21 12a9 9 0 1 1-3-6.7|M21 3v6h-6'},
  {id:'resource', label:'Resource Intelligence', icon:'M3 3v18h18|M7 15l4-5 3 3 5-7'},
  {id:'logistics', label:'Logistics', icon:'M3 8h18v11H3z|M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2'},
  {id:'crew', label:'Crew & Assignments', icon:'M12 8.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7|M4.5 20c0-4 3.5-6.5 7.5-6.5s7.5 2.5 7.5 6.5'},
  {id:'emergency', label:'Emergency', icon:'M12 2l9 16H3z|M12 9v4|M12 16.5h.01'},
  {id:'audit', label:'Audit / Event Log', icon:'M4 4h16v16H4z|M8 9h8|M8 13h8|M8 17h5'},
];

function seedTelemetry(stKey){
  const base = stKey==='maitri'
    ? {temp:-39, chill:-41, rpm:1780, fuelRate:12.4, fuel:68, batt:74, load:71, water:81, o2:20.8}
    : {temp:-34, chill:-37, rpm:1820, fuelRate:11.1, fuel:74, batt:82, load:63, water:88, o2:20.9};
  return {...base, chillHist:new Array(40).fill(base.chill), fuelHist:new Array(40).fill(base.fuelRate)};
}

let state = {
  ncpor:{},
  station:'bharati',
  scenario:'normal',
  online:true,
  view:'command',
  telemetry:{ bharati:seedTelemetry('bharati'), maitri:seedTelemetry('maitri') },
  queue:{ bharati:0, maitri:3 },
  retry:{ bharati:0, maitri:2 },
  lastSync:{ bharati:Date.now()-1000*60*4, maitri:Date.now()-1000*60*26 },
  packets:[],
  alarmLog:[],
  auditLog:[
    {time:Date.now()-1000*60*5, station:'MAITRI', event:'SATCOM degraded', sev:'WARNING'},
    {time:Date.now()-1000*60*6, station:'MAITRI', event:'Packet buffered', sev:'INFO'},
    {time:Date.now()-1000*60*9, station:'BHARATI', event:'Sync completed', sev:'SUCCESS'},
  ],
  alarmFilter:'all',
  syncing:false,
};

/* ============================================================
   STEP 3 — EMERGENCY VISUALIZATION
   NCPOR weather values are source-derived. Generator/life-support
   values are ANTARIS simulation/operational visualization only.
   ============================================================ */
function emergencyWeatherRisk(d){
  if(!d) return {level:'UNKNOWN',score:0,reasons:['No NCPOR weather observation available']};
  const reasons=[];
  let score=0;
  if(d.temp != null){
    if(d.temp <= -35){score+=3;reasons.push('Extreme cold');}
    else if(d.temp <= -25){score+=2;reasons.push('Severe cold');}
    else if(d.temp <= -15){score+=1;reasons.push('Low temperature');}
  }
  if(d.wind != null){
    const kt=Number(d.wind);
    if(kt >= 40){score+=3;reasons.push('Very high wind');}
    else if(kt >= 30){score+=2;reasons.push('High wind');}
    else if(kt >= 20){score+=1;reasons.push('Elevated wind');}
  }
  if(d.pressure != null && d.pressure < 950){score+=1;reasons.push('Low pressure');}
  const level=score>=5?'CRITICAL':score>=3?'HIGH':score>=1?'WATCH':'LOW';
  return {level,score,reasons};
}
function emergencyWeatherHtml(d,r){
  if(!d) return '<div class="empty-state">NCPOR observation unavailable.</div>';
  return `<div class="em-weather-grid">
    <div><span>TEMP</span><b>${ncpOrFmt(d.temp,'°C')}</b></div>
    <div><span>WIND</span><b>${ncpOrWind(d.wind)}</b></div>
    <div><span>PRESSURE</span><b>${ncpOrFmt(d.pressure,' mBar')}</b></div>
    <div><span>HUMIDITY</span><b>${ncpOrFmt(d.rh,'%')}</b></div>
  </div>
  <div class="risk-reasons">${r.reasons.length?r.reasons.map(x=>`<span>• ${x}</span>`).join(''):'<span>• No threshold exceeded</span>'}</div>`;
}
function renderEmergencyStep3(){
  const d=ncpOrData(ncpOrStationKey());
  const risk=emergencyWeatherRisk(d);
  const t=S().telemetry || {};
  const scenarioRisk=state.scenario==='emergency'?3:state.scenario==='generator_stress'?2:state.scenario==='extreme_cold'?2:0;
  const total=risk.score+scenarioRisk;
  const level=total>=6?'CRITICAL':total>=4?'HIGH':total>=2?'WATCH':'NOMINAL';

  const banner=document.getElementById('emergency-banner');
  const bannerText=document.getElementById('emergency-banner-text');
  const levelEl=document.getElementById('emergency-level');
  const riskPill=document.getElementById('weather-risk-pill');
  if(banner){
    banner.className=`emergency-banner ${level.toLowerCase()}`;
    if(bannerText)bannerText.textContent=level==='NOMINAL'?'SYSTEM NOMINAL':`${level} RESPONSE CONDITION`;
  }
  if(levelEl){levelEl.textContent=level;levelEl.className=`emergency-level ${level.toLowerCase()}`;}
  if(riskPill){riskPill.textContent=risk.level;riskPill.className=`risk-pill ${risk.level.toLowerCase()}`;}

  const gauge=document.getElementById('emergency-gauge');
  if(gauge){
    const pct=Math.min(100,Math.round(total/7*100));
    gauge.innerHTML=`<div class="radial-gauge ${level.toLowerCase()}"><div class="radial-value">${pct}<small>%</small></div><div class="radial-label">RESPONSE LOAD</div></div>`;
  }
  const ctx=document.getElementById('emergency-context');
  if(ctx)ctx.innerHTML=`<div class="em-context"><b>${S().short}</b><span>NCPOR weather risk: ${risk.level}</span><span>Scenario: ${SCENARIOS.find(s=>s.id===state.scenario)?.label||state.scenario}</span></div>`;

  const ew=document.getElementById('emergency-weather');
  if(ew)ew.innerHTML=emergencyWeatherHtml(d,risk);
  const bars=document.getElementById('weather-bars');
  if(bars){
    const tempPct=d?.temp==null?0:Math.min(100,Math.max(0,Math.round(Math.abs(d.temp)/50*100)));
    const windPct=d?.wind==null?0:Math.min(100,Math.round(Number(d.wind)/50*100));
    bars.innerHTML=`<div class="wbar"><span>COLD LOAD</span><i><b style="width:${tempPct}%"></b></i><em>${tempPct}%</em></div>
      <div class="wbar"><span>WIND LOAD</span><i><b style="width:${windPct}%"></b></i><em>${windPct}%</em></div>`;
  }

  const stress=document.getElementById('generator-stress');
  const genLoad=Number(t.load ?? 0);
  const stressLevel=genLoad>=95?'CRITICAL':genLoad>=80?'HIGH':genLoad>=60?'MEDIUM':'LOW';
  if(stress){stress.textContent=`${stressLevel} STRESS`;stress.className=`stress-pill ${stressLevel.toLowerCase()}`;}
  const gg=document.getElementById('generator-gauge');
  if(gg)gg.innerHTML=`<div class="stress-meter"><span>POWER BUS</span><i><b style="width:${Math.min(100,genLoad)}%"></b></i><strong>${genLoad}%</strong></div>
    <div class="stress-meter"><span>FUEL BURN</span><i><b style="width:${Math.min(100,Number(t.fuelRate||0)/25*100)}%"></b></i><strong>${Number(t.fuelRate||0).toFixed(1)} L/h</strong></div>`;

  const gf=document.getElementById('gen-fallback');
  if(gf)gf.innerHTML=`<div class="fallback-grid"><div><span>PRIMARY</span><b>DG-1 / CHP</b></div><div><span>BATTERY</span><b>${t.batt==null?'—':t.batt+'%'}</b></div><div><span>FALLBACK</span><b>${genLoad>=90?'ARMED':'STANDBY'}</b></div></div>`;

  const survival=document.getElementById('survival-load');
  const o2=Number(t.o2 ?? 20.9);
  const fuel=Number(t.fuel ?? 100);
  const load=genLoad;
  if(survival)survival.innerHTML=`<div class="survival-row"><span>O₂ ATMOSPHERE</span><i><b style="width:${Math.min(100,Math.max(0,(o2/20.9)*100))}%"></b></i><strong>${o2.toFixed(1)}%</strong></div>
    <div class="survival-row"><span>FUEL RESERVE</span><i><b style="width:${Math.min(100,Math.max(0,fuel))}%"></b></i><strong>${fuel.toFixed(0)}%</strong></div>
    <div class="survival-row"><span>POWER LOAD</span><i><b style="width:${Math.min(100,load)}%"></b></i><strong>${load}%</strong></div>`;
  const ss=document.getElementById('survival-status');
  const survivalLevel=(o2<19||fuel<20||load>=95)?'CRITICAL':(o2<20||fuel<35||load>=80)?'WATCH':'STABLE';
  if(ss){ss.textContent=survivalLevel;ss.className=`risk-pill ${survivalLevel==='STABLE'?'safe':survivalLevel.toLowerCase()}`;}

  const pr=document.getElementById('priority-list');
  if(pr)pr.innerHTML=['LIFE SUPPORT','HEATING / THERMAL CONTROL','POWER GENERATION','SATCOM / DATA LINK','WATER & HABITATION'].map((x,i)=>`<div class="priority-row"><span class="priority-tag">P${i+1}</span>${x}<span class="priority-state">${i===0&&survivalLevel==='CRITICAL'?'IMMEDIATE':'PROTECTED'}</span></div>`).join('');

  const alerts=document.getElementById('critical-alerts');
  const alertsList=[];
  if(risk.level==='CRITICAL'||risk.level==='HIGH')alertsList.push(`<div class="alert-row crit">NCPOR WEATHER THRESHOLD — ${risk.level}</div>`);
  if(state.scenario!=='normal')alertsList.push(`<div class="alert-row warn">SCENARIO ACTIVE — ${SCENARIOS.find(s=>s.id===state.scenario)?.label||state.scenario}</div>`);
  if(load>=95)alertsList.push('<div class="alert-row crit">GENERATOR POWER BUS NEAR LIMIT</div>');
  if(o2<19)alertsList.push('<div class="alert-row crit">OXYGEN RESERVE BELOW SAFE BAND</div>');
  if(!alertsList.length)alertsList.push('<div class="alert-row info">No critical alerts. Monitoring continuously.</div>');
  if(alerts)alerts.innerHTML=alertsList.join('');

  const src=document.getElementById('emergency-source-detail');
  if(src)src.innerHTML=`<div class="source-grid"><div><span>WEATHER</span><b>NCPOR ${d?.source||'unavailable'}</b></div><div><span>STATION</span><b>${S().short}</b></div><div><span>OPERATIONS</span><b>ANTARIS SIMULATION</b></div><div><span>LAST OBSERVATION</span><b>${d?.updated||'—'}</b></div></div>`;
}

/* ============================================================
   NCPOR DATA LAYER
   Source: https://data.ncpor.res.in/
   Source-backed weather observations; unavailable fields are never
   fabricated. SATCOM/generator/life-support values remain simulation.
   ============================================================ */
const NCPOR = {
  source:'https://data.ncpor.res.in/',
  live:{
    maitri:'https://data.ncpor.res.in/live/maitri',
    bharati:'https://data.ncpor.res.in/live/bharati'
  },
  cacheKey:'antaris.ncpor.v1',
  fallback:{
    maitri:{temp:-20.2,rh:23.68,pressure:964.58,wind:24.8,direction:222,directionText:'SW',updated:'09 Sep 2026 11:59 PM',source:'NCPOR live page snapshot'},
    bharati:{temp:-21.4,rh:null,pressure:null,wind:null,direction:null,directionText:'—',updated:'13 Sep 2026 11:00 PM',source:'NCPOR weather portal snapshot'}
  }
};
function ncpOrStationKey(){ return state.station==='maitri'?'maitri':'bharati'; }
function ncpOrNormalize(text){
  const pick = (patterns)=>{
    for(const p of patterns){ const m=text.match(p); if(m) return Number(m[1]); }
    return null;
  };
  const temp=pick([/Air Temperature:\s*[:|]?\s*(-?\d+(?:\.\d+)?)\s*°?\s*C/i,/temperature["':\s]+(-?\d+(?:\.\d+)?)/i]);
  const rh=pick([/Relative Humidity:\s*[:|]?\s*(\d+(?:\.\d+)?)\s*%/i,/humidity["':\s]+(\d+(?:\.\d+)?)/i]);
  const pressure=pick([/Air Pressure:\s*[:|]?\s*(\d+(?:\.\d+)?)\s*mBar/i,/pressure["':\s]+(\d+(?:\.\d+)?)/i]);
  const wind=pick([/Wind Speed and Direction:\s*[:|]?\s*(\d+(?:\.\d+)?)\s*knots/i,/wind[_\s-]*speed["':\s]+(\d+(?:\.\d+)?)/i]);
  const direction=pick([/knots\s*&\s*(\d+(?:\.\d+)?)°/i,/direction["':\s]+(\d+(?:\.\d+)?)/i]);
  const dm=text.match(/&\s*\d+(?:\.\d+)?°\s*([A-Z]{1,3})/i);
  const um=text.match(/(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  if([temp,rh,pressure,wind,direction].every(v=>v===null)) return null;
  return {temp,rh,pressure,wind,direction,directionText:dm?dm[1].toUpperCase():'—',updated:um?um[1]:new Date().toLocaleString(),source:'NCPOR live source'};
}
function ncpOrGetCached(key){try{return JSON.parse(localStorage.getItem(NCPOR.cacheKey)||'{}')[key]||null;}catch(e){return null;}}
function ncpOrCache(key,value){try{const a=JSON.parse(localStorage.getItem(NCPOR.cacheKey)||'{}');a[key]=value;localStorage.setItem(NCPOR.cacheKey,JSON.stringify(a));}catch(e){}}
function ncpOrData(key){return state.ncpor?.[key]||ncpOrGetCached(key)||NCPOR.fallback[key];}
function ncpOrFmt(v,s=''){return v==null||Number.isNaN(v)?'—':`${Number(v).toFixed(v%1?1:0)}${s}`;}
function ncpOrWind(v){return v==null?'—':`${Number(v).toFixed(1)} kt`;}
function renderNcpOrDetail(){
  const key=ncpOrStationKey(), d=ncpOrData(key);
  const el=document.getElementById('ncpor-detail'), pill=document.getElementById('ncpor-source-pill');
  const up=document.getElementById('ncpor-updated'), cs=document.getElementById('ncpor-command-station');
  if(!el||!d)return;
  if(cs)cs.textContent=S().short;
  if(pill){pill.textContent=d.source.includes('live')?'LIVE / SOURCE':'CACHED / SOURCE';pill.className=`ncpor-pill ${d.source.includes('live')?'live':'cached'}`;}
  if(up)up.textContent=`SOURCE: data.ncpor.res.in · ${d.updated}`;
  el.innerHTML=`<div class="ncpor-grid">
    <div class="ncpor-metric"><span>AIR TEMP</span><b>${ncpOrFmt(d.temp,'°C')}</b></div>
    <div class="ncpor-metric"><span>REL. HUMIDITY</span><b>${ncpOrFmt(d.rh,'%')}</b></div>
    <div class="ncpor-metric"><span>AIR PRESSURE</span><b>${ncpOrFmt(d.pressure,' mBar')}</b></div>
    <div class="ncpor-metric"><span>WIND SPEED</span><b>${ncpOrWind(d.wind)}</b></div>
    <div class="ncpor-metric"><span>WIND DIR.</span><b>${d.direction==null?'—':`${d.direction.toFixed(0)}° ${d.directionText}`}</b></div>
  </div><div class="ncpor-note">NCPOR meteorological observation layer. Missing fields are shown as unavailable rather than simulated.</div>`;
}
async function refreshNcpOr(){
  const key=ncpOrStationKey();
  try{
    const r=await fetch(NCPOR.live[key],{cache:'no-store'}); if(!r.ok)throw Error(`HTTP ${r.status}`);
    const d=ncpOrNormalize(await r.text()); if(!d)throw Error('Unrecognized NCPOR format');
    state.ncpor[key]=d;ncpOrCache(key,d);renderNcpOrDetail();showToast(`NCPOR ${S().short} data refreshed`);
  }catch(e){
    state.ncpor[key]=ncpOrGetCached(key)||NCPOR.fallback[key];renderNcpOrDetail();
    
  }
}


/* ============================================================
   UTILITIES
   ============================================================ */
function T(){ return state.telemetry[state.station]; }
function S(){ return STATIONS[state.station]; }
function fmtClock(ts){ return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit', hour12:false}); }
function fmtHM(ts){ return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit', hour12:false}); }
function timeAgo(ts){ const m=Math.round((Date.now()-ts)/60000); return m<1?'just now':m+' min ago'; }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function rnd(a,b){ return a+Math.random()*(b-a); }
function statusOf(val, warnT, critT, inverted){
  if(inverted){ if(val<=critT) return 'crit'; if(val<=warnT) return 'warn'; return 'ok'; }
  if(val>=critT) return 'crit'; if(val>=warnT) return 'warn'; return 'ok';
}
function pushAudit(station, event, sev){
  state.auditLog.unshift({time:Date.now(), station:station.toUpperCase(), event, sev});
  state.auditLog = state.auditLog.slice(0,60);
}

/* ============================================================
   SIMULATION — runs every 2s, station-differentiated
   ============================================================ */
function tick(){
  Object.keys(state.telemetry).forEach(key=>{
    const t = state.telemetry[key];
    const cfg = STATIONS[key];
    const scen = state.scenario;
    const jit = cfg.jitter;

    // Har scenario ke hisaab se live micro-jitter
    if(scen === 'extreme_cold'){
      t.chill = clamp(t.chill + rnd(-0.4, 0.3)*jit, -52, -45);
      t.fuelRate = clamp(t.fuelRate + rnd(-0.1, 0.3)*jit, 19, 23);
      t.load = clamp(t.load + rnd(-0.5, 0.5), 90, 97);
    } else if(scen === 'generator_stress'){
      t.rpm = Math.round(clamp(t.rpm + rnd(-20, 30)*jit, 2040, 2140));
      t.fuelRate = clamp(t.fuelRate + rnd(-0.2, 0.4), 17, 21);
      t.load = clamp(t.load + rnd(-0.5, 1.0), 94, 99);
    } else if(scen === 'emergency'){
      t.o2 = clamp(t.o2 + rnd(-0.03, 0.01), 18.3, 19.0);
      t.fuel = clamp(t.fuel - 0.05, 5, 20);
    } else {
      // Normal nominal drift
      let chillDrift = rnd(-0.3, 0.3)*jit;
      let fuelDrift = rnd(-0.2, 0.2)*jit;
      let rpmDrift = rnd(-15, 15)*jit;
      t.chill = clamp(t.chill + chillDrift, -45, -28);
      t.fuelRate = clamp(t.fuelRate + fuelDrift, 9, 15);
      t.rpm = Math.round(clamp(t.rpm + rpmDrift, 1650, 1900));
      t.load = clamp(t.load + rnd(-1, 1), 50, 75);
    }

    t.chillHist.push(t.chill); t.chillHist.shift();
    t.fuelHist.push(t.fuelRate); t.fuelHist.shift();

    if(Math.random() < cfg.retryChance && !state.online && key===state.station) state.retry[key]++;
  });

  const forcedOffline = state.scenario === 'connectivity_loss';
  if(forcedOffline) state.online = false;
  if(!state.online){
    const [lo, hi] = S().queueGrowth;
    state.queue[state.station] = Math.min(80, state.queue[state.station] + Math.round(rnd(lo, hi)));
  }

  genPackets();
  evaluateAlarmLog();
  renderAll();
refreshNcpOr();
}
setInterval(tick, 2000);
setInterval(()=>{ renderTopbarClock(); }, 1000);

function genPackets(){
  const t = T();
  const lines = [
    `<b>DG-1</b> Fuel Flow Sensor — Heartbeat <span class="ok">OK</span>`,
    `<b>DG-1</b> RPM: ${t.rpm}`,
    `Storage Tank 2 — Ultrasonic Level: ${t.fuel.toFixed(0)}%`,
    `Habitat O₂ Sensor: ${t.o2.toFixed(1)}%`,
    `Power Bus: <span class="ok">Stable</span>`,
    `Wind Sensor: ${t.chill.toFixed(0)}°C`,
    `Battery Bank: ${t.batt.toFixed(0)}%`,
    `Water Recycling Unit: ${t.water.toFixed(0)}%`,
  ];
  const pick = lines[Math.floor(Math.random()*lines.length)];
  state.packets.unshift(`<span style="color:var(--dim)">${fmtClock(Date.now())}</span> — ${pick} <span style="color:var(--dim)">[Modbus TCP · 128B]</span>`);
  state.packets = state.packets.slice(0,14);
}

function evaluateAlarmLog(){
  const t = T();
  const rows = computeAlarmRows(t);
  const lastText = state.alarmLog[0] ? state.alarmLog[0].text : null;
  rows.forEach(r=>{
    if(r.text !== lastText && Math.random()<0.6){
      state.alarmLog.unshift({time:Date.now(), level:r.level, text:r.text, station:S().short});
    }
  });
  state.alarmLog = state.alarmLog.slice(0,80);
}

/* ============================================================
   RENDERING — shell
   ============================================================ */
function renderShell(){
  const sel = document.getElementById('station-select');
  sel.innerHTML = Object.keys(STATIONS).map(k=>`<option value="${k}" ${state.station===k?'selected':''}>${STATIONS[k].label.toUpperCase()}</option>`).join('');

  document.getElementById('sidebar').innerHTML = NAV.map((n,i)=>`
    <div class="side-item ${state.view===n.id?'active':''}" onclick="setView('${n.id}')">
      <span class="side-num">${String(i+1).padStart(2,'0')}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${n.icon.split('|').map(p=>`<path d="${p}"/>`).join('')}</svg>
      <span>${n.label}</span>
    </div>
  `).join('') + `<div class="side-foot">ANTARIS Operations Platform<br>Offline-first · Polar Operations<div class="sim-tag"><span class="sd"></span>SIMULATION MODE</div></div>`;

  document.getElementById('mobile-nav').innerHTML = NAV.map(n=>`<button class="mnav-btn ${state.view===n.id?'active':''}" onclick="setView('${n.id}')">${n.label}</button>`).join('');

  renderTopbarClock();

  const stationSelect = document.getElementById('station-select');
  if (stationSelect && !stationSelect.dataset.bound) {
    stationSelect.addEventListener('change', e => changeStation(e.target.value));
    stationSelect.dataset.bound = '1';
  }
}

function satcomMetrics(){
  if(!state.online) return {label:'OFFLINE', cls:'crit', signal:0, rssi:'—', latency:'—', loss:'100%', tx:'0 Kbps', rx:'0 Kbps', band:'LINK DOWN', lock:'NO LOCK'};
  if(state.station==='maitri') return {label:'DEGRADED', cls:'warn', signal:62, rssi:'-78 dBm', latency:'684 ms', loss:'3.8%', tx:'96 Kbps', rx:'128 Kbps', band:'INMARSAT-C', lock:'TRACKING'};
  return {label:'NOMINAL', cls:'ok', signal:94, rssi:'-61 dBm', latency:'412 ms', loss:'0.4%', tx:'512 Kbps', rx:'768 Kbps', band:'GSAT-7 KU', lock:'LOCKED'};
}

function renderTopbarClock(){
  const m = satcomMetrics();
  document.getElementById('topbar-right').innerHTML = `
    <div class="tb-stat satcom-stat"><span class="tb-dot ${m.cls}"></span><span>SATCOM ${m.label}</span><span class="signal-bars">${[1,2,3,4].map(i=>`<i class="${i <= Math.ceil(m.signal/25) ? 'on':''}"></i>`).join('')}</span></div>
    <div class="tb-divider"></div>
    <div class="tb-stat">${fmtClock(Date.now())} IST</div>
    <div class="tb-divider"></div>
    <div class="tb-stat">SYNC ${timeAgo(state.lastSync[state.station]).toUpperCase()}</div>
    <div class="tb-divider"></div>
    <div class="tb-stat"><span class="tb-dot ${state.scenario==='emergency'?'crit':state.scenario==='normal'?'ok':'warn'}"></span>${state.scenario==='normal'?'SYSTEM OPERATIONAL':'SCENARIO: '+SCENARIOS.find(s=>s.id===state.scenario).label.toUpperCase()}</div>
  `;
  renderSatcomDetail(m);
}

function renderSatcomDetail(m){
  const pill = document.getElementById('satcom-state-pill');
  const box = document.getElementById('satcom-detail');
  if(!pill || !box) return;
  pill.className = `satcom-pill ${m.cls==='ok'?'nominal':m.cls==='warn'?'degraded':'offline'}`;
  pill.textContent = m.label;
  box.innerHTML = `
    <div class="satcom-health-grid">
      <div class="sat-metric"><span>LINK</span><b>${m.lock}</b></div>
      <div class="sat-metric"><span>SIGNAL</span><b>${m.signal}%</b></div>
      <div class="sat-metric"><span>RSSI</span><b>${m.rssi}</b></div>
      <div class="sat-metric"><span>LATENCY</span><b>${m.latency}</b></div>
      <div class="sat-metric"><span>PACKET LOSS</span><b>${m.loss}</b></div>
      <div class="sat-metric"><span>THROUGHPUT</span><b>${m.tx} ↑ / ${m.rx} ↓</b></div>
    </div>
    <div class="satcom-progress"><div class="satcom-progress-head"><span>LINK QUALITY</span><b>${m.band}</b></div><div class="satcom-track"><span style="width:${m.signal}%"></span></div></div>
  `;
}

function setView(v){
  state.view = v;
  renderShell();
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  document.getElementById('v-'+v).classList.add('active');
  renderAll();
}
function changeStation(k){
  state.station = k;
  pushAudit(STATIONS[k].short, 'Operator switched active station view', 'INFO');
  renderAll();
}
function setScenario(id){
  state.scenario = id;
  const t = T();

  if(id === 'normal'){
    state.online = true;
    if(state.station === 'bharati'){
      t.temp = -28; t.chill = -32; t.rpm = 1750; t.fuelRate = 10.5; t.fuel = 78; t.load = 58; t.o2 = 20.9;
    } else {
      t.temp = -38; t.chill = -41; t.rpm = 1880; t.fuelRate = 14.8; t.fuel = 52; t.load = 72; t.o2 = 20.7;
    }
    showToast('🟢 Mode: Nominal Polar Operations Active');
  }
  else if(id === 'connectivity_loss'){
    state.online = false;
    state.queue[state.station] = Math.max(state.queue[state.station] + 14, 18);
    showToast('🔴 SATCOM Cutoff — 0 Kbps (Buffer Logging Locally)');
  }
  else if(id === 'extreme_cold'){
    // Dramatic katabatic blizzard
    t.chill = -48.8;     // Turns CRITICAL RED instantly
    t.temp = -43.5;
    t.fuelRate = 21.6;   // Heavy thermal deficit heating
    t.load = 94;         // Power bus surge
    showToast('❄️ Blizzard Warning: Thermal Shock (-48.8°C)');
  }
  else if(id === 'generator_stress'){
    // Mechanical breakdown risk
    t.rpm = 2120;        // DG-1 RPM Alarm triggered
    t.fuelRate = 19.4;
    t.load = 98;         // Near failure
    t.batt = 42;
    showToast('⚠️ Mechanical Overload: DG-1 Stress Spike');
  }
  else if(id === 'emergency'){
    // Multi-system life support threat
    t.o2 = 18.7;         // Dangerously low
    t.fuel = 14;         // Reserve depleted
    t.fuelRate = 22.4;
    t.load = 99;
    showToast('🚨 CRITICAL: Station Life Support Emergency');
  }

  // Turant waveform SVG chart me change dikhane ke liye:
  t.chillHist.push(t.chill); t.chillHist.shift();
  t.fuelHist.push(t.fuelRate); t.fuelHist.shift();

  pushAudit(S().short, 'Scenario changed: ' + SCENARIOS.find(s=>s.id===id).label, id==='emergency'?'CRITICAL':id==='normal'?'SUCCESS':'WARNING');
  renderAll();
}

function renderAll(){
  renderShell();
  if(state.view==='command') renderCommand();
  else if(state.view==='telemetry') renderTelemetry();
  else if(state.view==='sync') renderSync();
  else if(state.view==='resource') renderResource();
  else if(state.view==='logistics') renderLogistics();
  else if(state.view==='crew') renderCrew();
  else if(state.view==='emergency') renderEmergency();
  else if(state.view==='audit') renderAudit();
}

/* ============================================================
   COMPONENTS — Mission Command
   ============================================================ */
function stationIdentityHtml(){
  const cfg = S();
  return `
    <div>
      <div class="si-title">${cfg.short} RESEARCH STATION</div>
      <div class="si-sub">${state.station==='bharati'?'MODERN EDGE SCADA':'HYBRID LEGACY GRID'}</div>
      <div class="si-nodes">${cfg.nodeProtocol}</div>
    </div>
    <div class="si-right">
      <div class="si-satcom-label">SATCOM</div>
      <div class="si-satcom-val ${state.online && state.station==='bharati' ? 'ok' : state.online ? 'warn':'warn'}">${state.online ? cfg.satcom : 'OFFLINE — BUFFERING LOCALLY'}</div>
    </div>
  `;
}
function scenarioRowHtml(){
  return SCENARIOS.map(s=>`<button class="scen-chip ${state.scenario===s.id?'active':''}" onclick="setScenario('${s.id}')">${s.label}</button>`).join('');
}

function kpiCardsHtml(t){
  return `
    <div class="kpi-card"><div class="kpi-label">WIND-CHILL</div><div class="kpi-value ${statusOf(t.chill,-40,-44,true)}">${t.chill.toFixed(0)}°C</div>
      <div class="kpi-sub"><span>OUTDOOR ${t.temp.toFixed(0)}°C</span><span class="tag badge ${statusOf(t.chill,-40,-44,true)}">${statusOf(t.chill,-40,-44,true)==='crit'?'CRITICAL':statusOf(t.chill,-40,-44,true)==='warn'?'WARNING':'NOMINAL'}</span></div></div>
    <div class="kpi-card"><div class="kpi-label">GENERATOR RPM</div><div class="kpi-value ${t.rpm>1980?'warn':'ok'}">${t.rpm}</div>
      <div class="kpi-sub"><span>DG-1 primary</span></div></div>
    <div class="kpi-card"><div class="kpi-label">FUEL BURN</div><div class="kpi-value ${statusOf(t.fuelRate,15,18,false)}">${t.fuelRate.toFixed(1)} L/hr</div>
      <div class="kpi-sub"><span>${t.fuelRate>12?'+':''}${(((t.fuelRate-11.5)/11.5)*100).toFixed(1)}% vs baseline</span></div></div>
    <div class="kpi-card"><div class="kpi-label">FUEL LEVEL</div><div class="kpi-value ${statusOf(t.fuel,35,20,true)}">${t.fuel.toFixed(0)}%</div>
      <div class="kpi-sub"><span>Storage Tank 2</span></div></div>
    <div class="kpi-card"><div class="kpi-label">POWER LOAD</div><div class="kpi-value ${statusOf(t.load,85,95,false)}">${t.load.toFixed(0)}%</div>
      <div class="kpi-sub"><span>Battery ${t.batt.toFixed(0)}%</span></div></div>
    <div class="kpi-card"><div class="kpi-label">HABITAT O₂</div><div class="kpi-value ${statusOf(t.o2,19.6,19.2,true)}">${t.o2.toFixed(1)}%</div>
      <div class="kpi-sub"><span>Nominal 20.9%</span></div></div>
  `;
}

function computeAlarmRows(t){
  const rows = [];
  if(t.chill<=-44) rows.push({level:'crit', text:`Severe wind-chill ${t.chill.toFixed(0)}°C — generator load rising.`});
  else if(t.chill<=-40) rows.push({level:'warn', text:`Wind-chill worsening (${t.chill.toFixed(0)}°C).`});
  if(t.fuelRate>=18) rows.push({level:'crit', text:`DG-1 fuel burn critical — ${t.fuelRate.toFixed(1)} L/hr.`});
  else if(t.fuelRate>=15) rows.push({level:'warn', text:`Fuel consumption trending up — ${t.fuelRate.toFixed(1)} L/hr.`});
  if(t.fuel<=20) rows.push({level:'crit', text:`Fuel level critical — ${t.fuel.toFixed(0)}% remaining.`});
  else if(t.fuel<=35) rows.push({level:'warn', text:`Fuel level below comfortable margin — ${t.fuel.toFixed(0)}%.`});
  if(t.o2<=19.2) rows.push({level:'crit', text:`Habitat O₂ critical — ${t.o2.toFixed(1)}%.`});
  else if(t.o2<=19.6) rows.push({level:'warn', text:`Habitat O₂ trending low — ${t.o2.toFixed(1)}%.`});
  if(t.load>=95) rows.push({level:'crit', text:`Power bus near capacity — ${t.load.toFixed(0)}% load.`});
  const q = state.queue[state.station];
  if(q>0) rows.push({level:'info', text:`${q} telemetry packets buffered — awaiting synchronization.`});
  if(state.retry[state.station]>3) rows.push({level:'warn', text:`${state.retry[state.station]} sync retries recorded on ${S().short}.`});
  return rows;
}

function renderCommand(){
  const t = T();
  document.getElementById('station-identity').innerHTML = stationIdentityHtml();
  document.getElementById('scenario-row').innerHTML = scenarioRowHtml();
  document.getElementById('kpi-grid').innerHTML = kpiCardsHtml(t);
  drawChart(t.chillHist, t.fuelHist);
  const rows = computeAlarmRows(t);
  document.getElementById('alarm-preview-count').textContent = rows.length + ' active';
  document.getElementById('alarm-preview').innerHTML = rows.slice(0,5).map(a=>`<div class="alarm-row ${a.level}"><span class="alarm-time">${fmtClock(Date.now())}</span><span>${a.text}</span></div>`).join('') || '<div class="alarm-row info">All systems nominal.</div>';
}

function drawChart(chillHist, fuelHist){
  const w=900,h=240,n=Math.max(chillHist.length,2);
  const chillMin=-50, chillMax=-25, fuelMin=5, fuelMax=24;
  const xAt=i=>(i/(n-1))*w;
  const yChill=v=>h-((v-chillMin)/(chillMax-chillMin))*h;
  const yFuel=v=>h-((v-fuelMin)/(fuelMax-fuelMin))*h;
  const ptsChill=chillHist.map((v,i)=>`${xAt(i).toFixed(1)},${yChill(v).toFixed(1)}`).join(' ');
  const ptsFuel=fuelHist.map((v,i)=>`${xAt(i).toFixed(1)},${yFuel(v).toFixed(1)}`).join(' ');

  let grid='';
  for(let i=0;i<=5;i++){
    const y=(h/5)*i;
    grid+=`<line x1="0" y1="${y}" x2="${w}" y2="${y}" class="chart-grid"/>`;
  }
  for(let i=1;i<9;i++){
    const x=(w/8)*i;
    grid+=`<line x1="${x}" y1="0" x2="${x}" y2="${h}" class="chart-grid"/>`;
  }

  const warnY=yChill(-40), critY=yChill(-44);
  const zones=`
    <rect x="0" y="${critY}" width="${w}" height="${h-critY}" class="zone-crit"/>
    <rect x="0" y="${warnY}" width="${w}" height="${critY-warnY}" class="zone-warn"/>
  `;

  const cX=xAt(chillHist.length-1), cY=yChill(chillHist[chillHist.length-1]);
  const fX=xAt(fuelHist.length-1), fY=yFuel(fuelHist[fuelHist.length-1]);

  const svg=document.getElementById('telemetry-chart');
  if(!svg) return;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  svg.innerHTML=`
    <defs>
      <linearGradient id="chillFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#16bdbc" stop-opacity=".24"/>
        <stop offset="100%" stop-color="#16bdbc" stop-opacity="0"/>
      </linearGradient>
      <filter id="softGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    ${zones}${grid}
    <polyline points="${ptsChill}" class="chart-area"/>
    <polyline points="${ptsChill}" class="chart-line chill-line" filter="url(#softGlow)"/>
    <polyline points="${ptsFuel}" class="chart-line fuel-line"/>
    <circle cx="${cX}" cy="${cY}" r="7" class="pulse-dot chill-dot"/>
    <circle cx="${cX}" cy="${cY}" r="3.5" class="live-dot chill-dot"/>
    <circle cx="${fX}" cy="${fY}" r="6" class="live-dot fuel-dot"/>
  `;

  const status = document.getElementById('chart-status');
  if(status){
    status.textContent = state.online ? '● LIVE' : '● BUFFERING';
    status.className = state.online ? 'chart-live' : 'chart-buffering';
  }
}
/* ============================================================
   COMPONENTS — Telemetry detail view
   ============================================================ */
function renderTelemetry(){
  renderNcpOrDetail();
  const t = T();
  document.getElementById('kpi-grid-2').innerHTML = kpiCardsHtml(t);
  document.getElementById('packet-feed').innerHTML = state.packets.map(p=>`<div class="packet-line">${p}</div>`).join('') || '<div class="packet-line">Awaiting telemetry…</div>';
}

/* ============================================================
   COMPONENTS — Offline Sync
   ============================================================ */
function renderSync(){
  const q = state.queue[state.station];
  const raw = (q*6.03 + 12).toFixed(1);
  const comp = (raw/14.2).toFixed(1);
  const link = state.online ? (state.station==='bharati' ? 'SATCOM Nominal — 512 Kbps' : 'SATCOM Degraded — 96 Kbps') : 'Restricted 32 Kbps Polar SATCOM';

  document.getElementById('pipeline').innerHTML = `
    <div class="pipe-step pipe-active"><div class="pipe-name"><span class="pipe-led"></span>FIELD SENSORS<span class="ps">${S().nodeProtocol}</span></div><span class="pipe-val">ACTIVE</span></div>
    <div class="pipe-arrow">↓</div>
    <div class="pipe-step pipe-active"><div class="pipe-name"><span class="pipe-led"></span>EDGE DEVICE<span class="ps">local processing unit</span></div><span class="pipe-val">ONLINE</span></div>
    <div class="pipe-arrow">↓</div>
    <div class="pipe-step pipe-buffer" id="pipe-buffer"><div class="pipe-name"><span class="pipe-led"></span>LOCAL OFFLINE BUFFER</div><span class="pipe-val">${state.online? '0' : q} PACKETS</span></div>
    <div class="pipe-arrow">↓ delta compression</div>
    <div class="pipe-step pipe-queue" id="pipe-queue"><div class="pipe-name"><span class="pipe-led"></span>PACKET QUEUE</div><span class="pipe-val">${q} PENDING</span></div>
    <div class="pipe-arrow">↓</div>
    <div class="pipe-step pipe-satcom" id="pipe-satcom"><div class="pipe-name"><span class="pipe-led"></span>SATCOM LINK</div><span class="pipe-val">${state.online?'CONNECTED':'OFFLINE'}</span></div>
    <div class="pipe-arrow">↓</div>
    <div class="pipe-step pipe-server" id="pipe-server"><div class="pipe-name"><span class="pipe-led"></span>NCPOR CENTRAL SERVER (GOA)</div><span class="pipe-val">${state.online?'REACHABLE':'UNREACHABLE'}</span></div>
  `;
  document.getElementById('m-raw').textContent = raw + ' KB';
  document.getElementById('m-comp').textContent = comp + ' KB';
  document.getElementById('m-saved').textContent = q>0 ? '93%' : '—';
  document.getElementById('m-link').textContent = link;
  document.getElementById('m-lastsync').textContent = timeAgo(state.lastSync[state.station]);
  document.getElementById('m-retry').textContent = state.retry[state.station];

  const btn = document.getElementById('sync-btn');
  btn.textContent = state.online ? 'SIMULATE CONNECTIVITY LOSS' : 'RESTORE CONNECTION';
  btn.disabled = state.syncing;
}

function toggleConnectivity(){
  if(state.online){
    state.online = false;
    showToast('🔴 Connectivity lost — buffering locally');
    pushAudit(S().short, 'SATCOM link lost — entering offline buffering', 'WARNING');
    renderAll();
    return;
  }
  const q = state.queue[state.station];
  if(q===0){
    state.online = true;
    if(state.scenario==='connectivity_loss') state.scenario='normal';
    state.lastSync[state.station] = Date.now();
    showToast('🟢 Connected — already up to date');
    pushAudit(S().short, 'Sync completed', 'SUCCESS');
    renderAll();
    return;
  }
  state.syncing = true;
  const steps = ['RECONNECTING','COMPRESSING DELTAS','SYNCING PACKETS','VERIFYING CHECKSUM','SYNC COMPLETE'];
  const toast = document.getElementById('toast');
  toast.classList.add('show');
  let i=0;
  const iv = setInterval(()=>{
    if(i<steps.length-1){
      toast.innerHTML = `<span class="spin"></span> ${steps[i]}…`;
      i++;
    }else{
      clearInterval(iv);
      state.queue[state.station]=0;
      state.retry[state.station]=0;
      state.online = true;
      state.syncing = false;
      if(state.scenario==='connectivity_loss') state.scenario='normal';
      state.lastSync[state.station] = Date.now();
      toast.innerHTML = `✓ SYNC COMPLETE — ${q} packets synchronized`;
      pushAudit(S().short, `${q} offline packets synchronized`, 'SUCCESS');
      setTimeout(()=>toast.classList.remove('show'), 1800);
      renderAll();
    }
  }, 550);
}
function resolveConflict(mode){
  const map = {
    local:{text:'Kept local value.', val:'72%'},
    server:{text:'Kept server value.', val:'70%'},
    merge:{text:'Latest timestamp selected.', val:'72%'}
  };
  const r = map[mode];
  const box = document.getElementById('conflict-success');
  box.classList.add('show');
  box.innerHTML = `✓ CONFLICT RESOLVED — ${r.text} Local value applied: ${r.val}`;
  pushAudit(S().short, 'Sync conflict resolved — '+r.text, 'INFO');
  showToast('Conflict resolved: ' + r.text);
}

/* ============================================================
   COMPONENTS — Resource Intelligence
   ============================================================ */
function renderResource(){
  const station = state.station;
  const t = T();
  const movementModes = {
    voyage:{
      pill:'IN TRANSIT', cls:'safe', title:'ANNUAL RESUPPLY VOYAGE',
      route:'Cape Town → Bharati → Maitri',
      meta:'Chartered cargo vessel · weather / sea-ice dependent',
      detail:'NCPOR describes this as the general voyage route for the Indian Antarctic programme.',
      eta:'SIM ETA · 08 DAYS',
      cargo:'Fuel · food · provisions · spares'
    },
    air:{
      pill:'SEASONAL', cls:'warn', title:'AIR BRIDGE',
      route:'Novo Airfield ↔ Bharati / Maitri',
      meta:'DROMLAN / intra-continental aircraft · summer access',
      detail:'NCPOR documents summer air operations with schedules dependent on weather and airfield conditions.',
      eta:'WINDOW · NOV–FEB',
      cargo:'Personnel · priority cargo · medical / technical loads'
    },
    station:{
      pill:'NETWORK', cls:'safe', title:'INTER-STATION TRANSFER',
      route:'Bharati ↔ Maitri',
      meta:'Operational transfer corridor · plan against weather and sea-ice',
      detail:'NCPOR identifies the stations as roughly 3,000 km apart and documents a 5–7 day ship leg.',
      eta:'REFERENCE · 5–7 DAYS',
      cargo:'Fuel · spares · provisions · equipment'
    }
  };
  const mode = window.__antarISMoveMode || 'voyage';
  const m = movementModes[mode];

  // STEP 7: synchronize route state with the mission timeline
  const routeWeatherRisk = (Number.isFinite(Number(t.temp)) && Number(t.temp) <= -25) || (Number.isFinite(Number(t.wind)) && Number(t.wind) >= 30) || Number(t.load||0) > 85;
  const airSeason = ['November','December','January','February'].includes(new Intl.DateTimeFormat('en-US',{month:'long'}).format(new Date()));
  const routeGates = [
    {id:'cargo',label:'CARGO READY',meta:'Manifest · fuel · provisions · spares',status:'READY',cls:'safe'},
    {id:'weather',label:'WEATHER WINDOW',meta:'Station observation / route conditions',status:routeWeatherRisk?'WATCH':'CLEAR',cls:routeWeatherRisk?'warn':'safe'},
    {id:'departure',label:'CAPE TOWN DEPARTURE',meta:'NCPOR charter-vessel voyage basis',status:routeWeatherRisk?'HOLD':'PLANNED',cls:routeWeatherRisk?'warn':'safe'},
    {id:'bharati',label:'BHARATI HANDOFF',meta:'Primary east-Antarctic logistics node',status:'PLANNED',cls:'safe'},
    {id:'maitri',label:'MAITRI HANDOFF',meta:'Inland station / final transfer node',status:'PLANNED',cls:'safe'},
    {id:'return',label:'RETURN CORRIDOR',meta:'Maitri → Cape Town',status:'PLANNED',cls:'safe'}
  ];
  const gates=document.getElementById('route-gates');
  if(gates){
    gates.innerHTML=routeGates.map((g,i)=>`<button class="route-gate ${g.cls}" data-gate="${g.id}"><span class="gate-index">0${i+1}</span><span class="gate-copy"><b>${g.label}</b><small>${g.meta}</small></span><em>${g.status}</em></button>${i<routeGates.length-1?'<span class="gate-arrow">→</span>':''}`).join('');
    document.querySelectorAll('[data-gate]').forEach(btn=>btn.onclick=()=>{
      const g=routeGates.find(x=>x.id===btn.dataset.gate);
      const note=document.getElementById('route-gate-note');
      if(note) note.innerHTML = g.id==='weather' && routeWeatherRisk ? '<b>Route gate:</b> weather watch is active. ANTARIS simulation marks movement for operator review; NCPOR observations are the source layer.' : `<b>${g.label}:</b> ${g.meta}. Status shown is a prototype planning state, not a live dispatch authorization.`;
      document.querySelectorAll('[data-gate]').forEach(x=>x.classList.remove('selected')); btn.classList.add('selected');
    });
  }

  const ns = document.getElementById('network-status');
  if(ns){ ns.textContent = t.load > 85 ? 'WATCH' : 'NOMINAL'; ns.className='kpi-value '+(t.load>85?'warn':'ok'); }
  const cd = document.getElementById('cargo-count');
  if(cd) cd.textContent = station==='bharati' ? '04' : '03';

  document.querySelectorAll('[data-move]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.move===mode);
    btn.onclick=()=>{window.__antarISMoveMode=btn.dataset.move;renderResource();};
  });

  document.querySelectorAll('[data-route]').forEach(r=>{
    r.classList.toggle('route-active', (mode==='air' && r.dataset.route==='air') || (mode!=='air' && r.dataset.route==='ship'));
  });

  const pill=document.getElementById('movement-pill');
  if(pill){pill.textContent=m.pill;pill.className=`risk-pill ${m.cls}`;}
  const detail=document.getElementById('movement-detail');
  if(detail){
    detail.innerHTML=`
      <div class="movement-title">${m.title}</div>
      <div class="movement-route">${m.route}</div>
      <div class="movement-meta">${m.meta}</div>
      <div class="movement-eta"><span>${m.eta}</span><b>${m.cargo}</b></div>
      <div class="movement-note">${m.detail}</div>
    `;
  }

  const manifest = [
    ['JET A-1 / FUEL','Bulk + drums','HIGH PRIORITY'],
    ['FOOD / PROVISIONS','Seasonal stock','NORMAL'],
    ['STATION SPARES','Technical reserve','HIGH PRIORITY'],
    ['SCIENTIFIC CARGO','Mission-dependent','NORMAL']
  ];
  const cm=document.getElementById('cargo-manifest');
  if(cm) cm.innerHTML=manifest.map((x,i)=>`
    <div class="cargo-row"><span class="cargo-index">0${i+1}</span><div><b>${x[0]}</b><small>${x[1]}</small></div><em>${x[2]}</em></div>`).join('');

  const fuel=Math.max(0,Math.min(100,Number(t.fuel||0)));
  const water=Math.max(0,Math.min(100,Number(t.water||0)));
  const power=Math.max(0,Math.min(100,Number(t.load||0)));
  const transfers=[
    ['FUEL REPLENISHMENT',Math.min(100,Math.max(8,100-fuel+20))],
    ['WATER / CONSUMABLES',Math.min(100,Math.max(10,100-water+15))],
    ['SPARES / EQUIPMENT',Math.min(100,55+(power>80?15:0))]
  ];
  const tb=document.getElementById('transfer-bars');
  if(tb) tb.innerHTML=transfers.map(([n,v])=>`
    <div class="transfer-row"><div><span>${n}</span><b>${v.toFixed(0)}%</b></div><i><b style="width:${v}%"></b></i></div>`).join('');

  // STEP 6: Operations timeline + live NCPOR weather context
  const key=state.station, d=ncpOrData(key);
  const activeStation=key==='bharati'?'BHARATI':'MAITRI';
  const temp=Number(d?.temp), wind=Number(d?.wind);
  const weatherRisk=(Number.isFinite(temp)&&temp<=-25)||(Number.isFinite(wind)&&wind>=30);
  const events=[
    {id:1,time:'T−06:00',type:'logistics',icon:'◈',title:'Cargo manifest verified',desc:'Fuel, provisions, station spares and scientific cargo cleared for movement.',sev:'safe'},
    {id:2,time:'T−04:30',type:'weather',icon:'◌',title:`${activeStation} weather observation received`,desc:`NCPOR observation: ${Number.isFinite(temp)?temp.toFixed(1)+' °C':'temperature unavailable'} · ${Number.isFinite(wind)?wind.toFixed(1)+' kt':'wind unavailable'}.`,sev:weatherRisk?'warn':'safe'},
    {id:3,time:'T−03:10',type:'crew',icon:'◎',title:'Crew accountability check',desc:'Station personnel status acknowledged in the ANTARIS operations model.',sev:'safe'},
    {id:4,time:'T−02:15',type:'logistics',icon:'→',title:'Resupply corridor monitored',desc:'Cape Town → Bharati → Maitri voyage network and seasonal air corridors remain under planning.',sev:'safe'},
    {id:5,time:'T−01:20',type:'weather',icon:'△',title:'Environmental watch updated',desc:'Weather-derived operational watch recalculated from the selected NCPOR station observation.',sev:weatherRisk?'warn':'safe'},
    {id:6,time:'T−00:45',type:'crew',icon:'◇',title:'Scientific operations window',desc:'Research activity and station support remain inside the prototype mission window.',sev:'safe'},
    {id:7,time:'T−00:20',type:'emergency',icon:'!',title:'Emergency readiness test',desc:'Fallback power, life-support and response pathways are armed in simulation.',sev:t.load>85?'warn':'safe'},
    {id:8,time:'NOW',type:'logistics',icon:'●',title:'Operations control synchronized',desc:'Station telemetry, NCPOR weather and logistics state are synchronized for the dashboard.',sev:'safe'}
  ];
  const stateEl=document.getElementById('ops-state');
  const opState=weatherRisk||t.load>85?'WATCH':'NOMINAL';
  if(stateEl){stateEl.textContent=opState;stateEl.className='kpi-value '+(opState==='WATCH'?'warn':'ok');}
  const os=document.getElementById('ops-station'); if(os)os.textContent=activeStation;
  const ec=document.getElementById('ops-event-count'); if(ec)ec.textContent=String(events.length).padStart(2,'0');
  const sourceLayers=document.querySelector('.ops-kpi-grid .kpi-card:last-child .kpi-value'); if(sourceLayers)sourceLayers.textContent='NCPOR + SIM';
  const filter=window.__opsFilter||'all';
  document.querySelectorAll('[data-filter]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.filter===filter);
    btn.onclick=()=>{window.__opsFilter=btn.dataset.filter;renderResource();};
  });
  const shown=filter==='all'?events:events.filter(x=>x.type===filter);
  const tl=document.getElementById('ops-timeline');
  if(tl)tl.innerHTML=shown.map(ev=>`<button class="ops-event ${ev.sev}" data-event-id="${ev.id}"><span class="ops-time">${ev.time}</span><span class="ops-icon">${ev.icon}</span><span class="ops-event-copy"><b>${ev.title}</b><small>${ev.desc}</small></span><span class="ops-type">${ev.type}</span></button>`).join('');
  document.querySelectorAll('[data-event-id]').forEach(btn=>{btn.onclick=()=>{const ev=events.find(x=>x.id==btn.dataset.eventId);document.querySelectorAll('[data-event-id]').forEach(x=>x.classList.remove('selected'));btn.classList.add('selected');const pill=document.getElementById('ops-detail-pill');if(pill){pill.textContent=ev.type.toUpperCase();pill.className=`risk-pill ${ev.sev}`;}const det=document.getElementById('ops-detail');if(det)det.innerHTML=`<div class="detail-time">${ev.time}</div><div class="detail-title">${ev.title}</div><div class="detail-type">${ev.type.toUpperCase()}</div><p>${ev.desc}</p><div class="detail-source">${ev.type==='weather'?'NCPOR observation layer':'ANTARIS operational model'}</div>`;const gateMap={1:'cargo',2:'weather',4:'departure',8:'bharati'};const gid=gateMap[ev.id];if(gid){const gb=document.querySelector(`[data-gate="${gid}"]`);if(gb)gb.click();}};});
  const ow=document.getElementById('ops-weather');
  if(ow)ow.innerHTML=[['AIR TEMPERATURE',Number.isFinite(temp)?`${temp.toFixed(1)} °C`:'—'],['RELATIVE HUMIDITY',d?.rh!=null?`${Number(d.rh).toFixed(1)} %`:'—'],['PRESSURE',d?.pressure!=null?`${Number(d.pressure).toFixed(1)} mBar`:'—'],['WIND',Number.isFinite(wind)?`${wind.toFixed(1)} kt`:'—']].map(x=>`<div class="weather-mini"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
  const opsFuel=Number(t.fuel||0), opsWater=Number(t.water||0), opsLoad=Number(t.load||0);
  const readiness=Math.round((opsFuel+opsWater+(100-opsLoad))/3);
  const rp=document.getElementById('readiness-pill'); const rl=readiness<35?'CRITICAL':readiness<55?'WATCH':'READY';
  if(rp){rp.textContent=rl;rp.className=`risk-pill ${rl==='READY'?'safe':rl==='WATCH'?'warn':'crit'}`;}
  const rr=document.getElementById('ops-readiness');
  if(rr)rr.innerHTML=`<div class="readiness-score">${readiness}%</div><div class="readiness-caption">prototype mission readiness</div><div class="readiness-bar"><i><b style="width:${readiness}%"></b></i></div><div class="readiness-mini"><span>Fuel ${fuel.toFixed(0)}%</span><span>Water ${water.toFixed(0)}%</span><span>Load ${load.toFixed(0)}%</span></div>`;
}

/* ============================================================
   COMPONENTS — Logistics
   ============================================================ */
function renderLogistics(){
  const t = T();
  const items = [
    {name:'FUEL', stock: Math.round((t.fuel/100)*20000)+' L', daily:Math.round(t.fuelRate*24)+' L/day', days: Math.round((t.fuel/100*20000)/(t.fuelRate*24)), priority:'HIGH PRIORITY'},
    {name:'WATER', stock: Math.round(t.water*8)+' L', daily:'120 L/day', days: Math.round(t.water*8/120), priority:'MEDIUM'},
    {name:'FOOD', stock:'1,420 kg', daily:'21 kg/day', days:67, priority:'LOW'},
    {name:'MEDICAL SUPPLIES', stock:'42 cylinders', daily:'1.2/day', days:35, priority:'MEDIUM'},
    {name:'TECHNICAL SPARES', stock:'34 units', daily:'1.1/day', days:31, priority:'MEDIUM'},
    {name:'SCIENTIFIC EQUIPMENT', stock:'Operational', daily:'—', days:'—', priority:'LOW'},
  ];
  document.getElementById('logistics-body').innerHTML = items.map(it=>{
    let status='NORMAL', badge='safe';
    if(typeof it.days==='number'){
      if(it.days<20){ status='CRITICAL STOCK'; badge='crit'; }
      else if(it.days<40){ status='LOW STOCK'; badge='warn'; }
      if(it.days<15){ status='RESUPPLY REQUIRED'; badge='crit'; }
    }
    return `<tr><td class="mono">${it.name}</td><td class="mono">${it.stock}</td><td class="mono">${it.daily}</td><td class="mono">${it.days}${typeof it.days==='number'?' DAYS':''}</td><td>${it.priority}</td><td><span class="badge ${badge}">${status}</span></td></tr>`;
  }).join('');
}

/* ============================================================
   COMPONENTS — Crew
   ============================================================ */
function renderCrew(){
  const isB=state.station==='bharati';
  const total=isB?24:16, onDuty=isB?18:11, field=isB?6:3, medical=isB?2:2, eng=isB?5:4;
  const readiness=Math.max(0,Math.min(100,Math.round((onDuty/total)*70 + (100-(T().load||0))*0.3)));
  const cycle=state.scenario==='emergency'?'REVIEW REQUIRED':readiness<55?'WATCH':'ON PLAN';
  document.getElementById('crew-cards').innerHTML=`
    <div class="kpi-card"><div class="kpi-label">TOTAL PERSONNEL</div><div class="kpi-value">${total}</div><div class="kpi-sub">prototype roster</div></div>
    <div class="kpi-card"><div class="kpi-label">ON DUTY</div><div class="kpi-value ok">${onDuty}</div><div class="kpi-sub">current station model</div></div>
    <div class="kpi-card"><div class="kpi-label">FIELD TEAM</div><div class="kpi-value">${field}</div><div class="kpi-sub">field operations</div></div>
    <div class="kpi-card"><div class="kpi-label">MEDICAL TEAM</div><div class="kpi-value">${medical}</div><div class="kpi-sub">coverage indicator</div></div>
    <div class="kpi-card"><div class="kpi-label">ENGINEERING TEAM</div><div class="kpi-value">${eng}</div><div class="kpi-sub">systems support</div></div>`;

  const roster=[
    ['C-01','Station Lead','Leadership',isB?'Bharati':'Maitri','ON DUTY','READY'],
    ['C-02','Field Scientist','Science',isB?'Bharati':'Maitri','FIELD','READY'],
    ['C-03','Systems Engineer','Engineering',isB?'Bharati':'Maitri','ON DUTY',T().load>85?'WATCH':'READY'],
    ['C-04','Medical Officer','Medical',isB?'Bharati':'Maitri','ON DUTY','READY'],
    ['C-05','Logistics Coordinator','Logistics','Voyage','TRANSIT','READY'],
    ['C-06','Communications Officer','Communications',isB?'Bharati':'Maitri','ON DUTY','READY'],
    ['C-07','Field Engineer','Engineering',isB?'Bharati':'Maitri','FIELD','WATCH'],
    ['C-08','Science Support','Science','Voyage','INDUCTION','READY']
  ];
  const filter=window.__crewFilter||'all';
  document.querySelectorAll('[data-crew-filter]').forEach(btn=>{btn.classList.toggle('active',btn.dataset.crewFilter===filter);btn.onclick=()=>{window.__crewFilter=btn.dataset.crewFilter;renderCrew();};});
  const shown=filter==='all'?roster:roster.filter(r=>r[3].toLowerCase()===filter);
  const rr=document.getElementById('crew-roster');
  if(rr) rr.innerHTML=shown.map(r=>`<button class="crew-person" data-crew-id="${r[0]}"><span class="crew-id">${r[0]}</span><span class="crew-person-main"><b>${r[1]}</b><small>${r[2]} · ${r[3]}</small></span><span class="crew-duty ${r[4].toLowerCase().replace(' ','-')}">${r[4]}</span><em class="badge ${r[5]==='READY'?'safe':'warn'}">${r[5]}</em></button>`).join('');
  document.querySelectorAll('[data-crew-id]').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('[data-crew-id]').forEach(x=>x.classList.remove('selected'));btn.classList.add('selected');showToast('Crew profile selected: '+btn.dataset.crewId);});

  const cp=document.getElementById('crew-cycle-pill');
  if(cp){cp.textContent=cycle;cp.className=`risk-pill ${cycle==='ON PLAN'?'safe':cycle==='WATCH'?'warn':'crit'}`;}
  const cc=document.getElementById('crew-cycle');
  if(cc) cc.innerHTML=`<div class="cycle-track"><div class="cycle-step done"><b>01</b><span>INDUCT</span><small>Briefing + training</small></div><div class="cycle-line"></div><div class="cycle-step active"><b>02</b><span>DEPLOY</span><small>${isB?'Bharati':'Maitri'} assignment</small></div><div class="cycle-line"></div><div class="cycle-step"><b>03</b><span>ROTATE</span><small>Batch / season dependent</small></div><div class="cycle-line"></div><div class="cycle-step"><b>04</b><span>DE-INDUCT</span><small>Return movement</small></div></div><div class="cycle-note">NCPOR documents batch-based induction/de-induction and expedition movement dependent on available ship/flights and project requirements.</div>`;
  const tasks=[['T-01','Station systems watch','Engineering','ACTIVE',T().load>85?'warn':'safe'],['T-02','Scientific operations window','Science','ACTIVE','safe'],['T-03','Crew accountability','Leadership','COMPLETE','safe'],['T-04','Logistics handoff','Logistics','PLANNED','safe'],['T-05','Emergency readiness drill','Emergency',state.scenario==='emergency'?'ACTIVE':'PLANNED',state.scenario==='emergency'?'warn':'safe']];
  const ct=document.getElementById('crew-tasks');
  if(ct) ct.innerHTML=tasks.map(x=>`<div class="crew-task"><span class="task-code">${x[0]}</span><div><b>${x[1]}</b><small>${x[2]}</small></div><em class="badge ${x[4]}">${x[3]}</em></div>`).join('');
}


/* ============================================================
   COMPONENTS — Emergency
   ============================================================ */
function renderEmergency(){
  renderEmergencyStep3();
  const t=T();
  const o2status=t.o2<19.2?'CRITICAL':t.o2<19.6?'WARNING':'NOMINAL';
  const cabin=state.scenario==='emergency'||state.scenario==='generator_stress'?'REDUCED':'NOMINAL';
  const co2=state.scenario==='emergency'?'RISING':'OK';
  const water=t.water<20?'REDUCED EFFICIENCY':'ACTIVE';
  const badgeOf=v=>({NOMINAL:'safe',OK:'safe',ACTIVE:'safe',WARNING:'warn',REDUCED:'warn','REDUCED EFFICIENCY':'warn',CRITICAL:'crit',RISING:'crit'})[v]||'neutral';

  const emergencyMode=state.scenario==='emergency';
  const stress=state.scenario==='generator_stress';
  const level=emergencyMode?'CRITICAL':stress||t.load>=95||t.o2<19.6?'WARNING':'NOMINAL';

  const levelEl=document.getElementById('emergency-level');
  if(levelEl){
    levelEl.textContent=level;
    levelEl.className='emergency-level '+(level==='CRITICAL'?'crit':level==='WARNING'?'warn':'safe');
  }

  const gauge=document.getElementById('emergency-gauge');
  if(gauge){
    const o2Pct=Math.max(0,Math.min(100,((t.o2-18)/3)*100));
    gauge.innerHTML=`
      <div class="big-gauge">
        <div class="gauge-ring" style="--value:${o2Pct}%;"><div class="gauge-center"><strong>${t.o2.toFixed(1)}%</strong><span>O₂</span></div></div>
        <div class="gauge-side"><span>ATMOSPHERE</span><b>${o2status}</b><small>Nominal target 20.9%</small></div>
      </div>`;
  }

  document.getElementById('life-support').innerHTML=`
    <div class="ls-row"><div class="ls-name">Habitat O₂<div class="ls-sub">${t.o2.toFixed(1)}%</div></div><span class="badge ${badgeOf(o2status)}">${o2status}</span></div>
    <div class="ls-row"><div class="ls-name">Cabin Air Circulation</div><span class="badge ${badgeOf(cabin)}">${cabin}</span></div>
    <div class="ls-row"><div class="ls-name">CO₂ Status</div><span class="badge ${badgeOf(co2)}">${co2}</span></div>
    <div class="ls-row"><div class="ls-name">Water Recycling<div class="ls-sub">${t.water.toFixed(0)}% reserve</div></div><span class="badge ${badgeOf(water)}">${water}</span></div>
  `;

  const fallbackActive=stress||emergencyMode||t.fuelRate>=18;
  const stressPct=Math.max(0,Math.min(100,(t.load-40)/60*100));
  const stressEl=document.getElementById('generator-stress');
  if(stressEl){
    const stressLabel=t.load>=97?'CRITICAL STRESS':t.load>=90?'HIGH STRESS':t.load>=75?'ELEVATED':'LOW STRESS';
    stressEl.textContent=stressLabel;
    stressEl.className='stress-pill '+(t.load>=97?'crit':t.load>=90?'warn':'safe');
  }
  const genGauge=document.getElementById('generator-gauge');
  if(genGauge){
    genGauge.innerHTML=`
      <div class="stress-meter">
        <div class="stress-meter-head"><span>DG-1 LOAD</span><b>${t.load.toFixed(0)}%</b></div>
        <div class="stress-track"><span style="width:${t.load}%" class="${t.load>=97?'crit':t.load>=90?'warn':''}"></span></div>
        <div class="stress-scale"><span>40</span><span>75</span><span>90</span><span>100%</span></div>
      </div>`;
  }

  document.getElementById('gen-fallback').innerHTML=`
    <div class="ls-row"><div class="ls-name">Primary Generator (DG-1)<div class="ls-sub">${t.rpm} RPM · ${t.fuelRate.toFixed(1)} L/hr</div></div><span class="badge ${fallbackActive?'warn':'safe'}">${fallbackActive?'STRESSED':'ACTIVE'}</span></div>
    <div class="ls-row"><div class="ls-name">Backup Generator (DG-2)</div><span class="badge ${fallbackActive?'warn':'neutral'}">${fallbackActive?'AUTO-FAILOVER READY':'STANDBY'}</span></div>
    <div class="ls-row"><div class="ls-name">Fuel Reserve</div><span class="badge ${statusOf(t.fuel,35,20,true)==='ok'?'safe':statusOf(t.fuel,35,20,true)}">${t.fuel.toFixed(0)}%</span></div>
  `;

  document.getElementById('priority-list').innerHTML=`
    <div class="priority-row"><span class="priority-tag">P1</span>Life Support</div>
    <div class="priority-row"><span class="priority-tag">P2</span>Power</div>
    <div class="priority-row"><span class="priority-tag">P3</span>Fuel</div>
    <div class="priority-row"><span class="priority-tag">P4</span>Communications</div>
    <div class="priority-row"><span class="priority-tag">P5</span>Non-critical Systems</div>
  `;

  const alerts=[];
  if(emergencyMode) alerts.push({level:'crit',text:'CRITICAL — Station emergency mode engaged.'});
  if(stress) alerts.push({level:'crit',text:`DG-1 operating at ${t.load.toFixed(0)}% load — failover readiness elevated.`});
  if(fallbackActive) alerts.push({level:'warn',text:'Fallback Generator: STANDBY → Automatic failover available.'});
  if(t.o2<19.6) alerts.push({level:'warn',text:'Habitat O₂ trending toward threshold.'});
  if(t.fuel<25) alerts.push({level:'crit',text:'Fuel reserve below critical threshold.'});
  if(alerts.length===0) alerts.push({level:'info',text:'No critical alerts. All emergency systems nominal.'});
  document.getElementById('critical-alerts').innerHTML=alerts.map(a=>`<div class="alarm-row ${a.level}"><span class="alarm-time">${fmtClock(Date.now())}</span><span>${a.text}</span></div>`).join('');
}
/* ============================================================
   COMPONENTS — Alarm Center + Audit Log
   ============================================================ */
function setAlarmFilter(f){ state.alarmFilter = f; renderAudit(); }
function renderAudit(){
  document.getElementById('alarm-filters').innerHTML = ['all','crit','warn','info'].map(f=>
    `<button class="af-btn ${state.alarmFilter===f?'active':''}" onclick="setAlarmFilter('${f}')">${f==='all'?'All':f==='crit'?'Critical':f==='warn'?'Warning':'Info'}</button>`
  ).join('');
  const list = state.alarmLog.filter(a=> state.alarmFilter==='all' || a.level===state.alarmFilter).slice(0,30);
  document.getElementById('alarm-full-list').innerHTML = list.map(a=>`
    <div class="alarm-row ${a.level}"><span class="alarm-time">${fmtClock(a.time)}</span><span>[${a.station}] ${a.text}</span></div>
  `).join('') || '<div class="alarm-row info">No alarms recorded yet.</div>';

  document.getElementById('audit-body').innerHTML = state.auditLog.map(a=>`
    <tr><td class="mono">${fmtClock(a.time)}</td><td class="mono">${a.station}</td><td>${a.event}</td><td><span class="badge ${a.sev==='CRITICAL'?'crit':a.sev==='WARNING'?'warn':a.sev==='SUCCESS'?'safe':'neutral'}">${a.sev}</span></td></tr>
  `).join('');
}

/* ============================================================
   TOAST
   ============================================================ */
function showToast(msg){
  const t = document.getElementById('toast');
  t.innerHTML = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ============================================================
   BOOT — straight into Mission Command, no landing page
   ============================================================ */
renderAll();
/* ============================================================
   ANTARIS BACKEND + SQLITE BRIDGE
   The UI remains simulation/offline-first. When the local backend is
   available, operational writes are persisted in SQLite and selected
   persisted state is hydrated back into the UI.
   ============================================================ */
const ANTARIS_API = `${window.location.protocol}//${window.location.host}/api`;

async function apiRequest(path, options={}) {
  const r = await fetch(ANTARIS_API + path, {
    headers: {'Content-Type':'application/json', ...(options.headers||{})},
    ...options
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

async function backendHealth() {
  try { return await apiRequest('/health'); }
  catch { return null; }
}

async function backendTelemetryPush() {
  try {
    const t = T();
    await apiRequest('/telemetry', {
      method:'POST',
      body:JSON.stringify({station:state.station,...t})
    });
  } catch (e) { /* keep UI functional when backend is unavailable */ }
}

async function backendAudit(event, sev='INFO') {
  try {
    await apiRequest('/audit', {
      method:'POST',
      body:JSON.stringify({station:state.station,event,sev})
    });
  } catch (e) {}
}

async function backendEmergency() {
  try {
    const t=T();
    const level=state.scenario==='emergency'?'CRITICAL':state.scenario==='normal'?'NOMINAL':'WARNING';
    await apiRequest('/emergency', {
      method:'POST',
      body:JSON.stringify({
        station:state.station,
        level,
        scenario:state.scenario,
        details:JSON.stringify({load:t.load,fuel:t.fuel,o2:t.o2,chill:t.chill})
      })
    });
  } catch (e) {}
}

async function backendQueuePacket() {
  try {
    const t=T();
    await apiRequest('/sync/queue', {
      method:'POST',
      body:JSON.stringify({station:state.station,payload:{...t,scenario:state.scenario}})
    });
  } catch (e) {}
}

async function backendFlush() {
  try { return await apiRequest(`/sync/${state.station}/flush`, {method:'POST'}); }
  catch (e) { return null; }
}

async function backendHydrate() {
  try {
    const [health, telemetry, audit, queue] = await Promise.all([
      backendHealth(),
      apiRequest(`/stations/${state.station}/telemetry`),
      apiRequest('/audit'),
      apiRequest(`/sync/queue/${state.station}`)
    ]);

    if (telemetry && telemetry.station === state.station) {
      const current = state.telemetry[state.station];
      state.telemetry[state.station] = {
        ...current,
        ...telemetry,
        chillHist: current.chillHist || [],
        fuelHist: current.fuelHist || []
      };
    }
    if (Array.isArray(audit) && audit.length) {
      state.auditLog = audit.map(a => ({time:a.ts,station:a.station,event:a.event,sev:a.sev}));
    }
    if (queue && typeof queue.pending === 'number') {
      state.queue[state.station] = queue.pending;
    }

    renderAll();
    if (health?.database?.engine === 'SQLite' && typeof showToast === 'function') {
      showToast('● SQLite backend connected');
    }
  } catch (e) {
    // The prototype intentionally continues in local simulation mode.
  }
}

window.addEventListener('online',()=>{
  if(typeof showToast==='function') showToast('🟢 Network available — backend reachable');
  backendFlush();
});

const _setScenario=setScenario;
setScenario=function(id){
  _setScenario(id);
  backendAudit('Scenario changed: '+id,id==='emergency'?'CRITICAL':id==='normal'?'SUCCESS':'WARNING');
  backendEmergency();
  backendTelemetryPush();
};

const _changeStation=changeStation;
changeStation=function(k){
  _changeStation(k);
  backendAudit('Operator switched active station view','INFO');
  backendTelemetryPush();
  backendHydrate();
};

const _toggleConnectivity=toggleConnectivity;
toggleConnectivity=function(){
  const wasOnline=state.online;
  _toggleConnectivity();
  if(wasOnline){
    backendAudit('SATCOM link lost — entering offline buffering','WARNING');
  } else {
    backendFlush();
    backendAudit('Sync requested','INFO');
  }
};

const _resolveConflict=resolveConflict;
resolveConflict=function(mode){
  _resolveConflict(mode);
  backendAudit('Sync conflict resolved — '+mode,'INFO');
};

backendHydrate();
setInterval(()=>{
  backendTelemetryPush();
  if(!state.online) backendQueuePacket();
},10000);
