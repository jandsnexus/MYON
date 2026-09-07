/* ============================================================
   Gym Tracker — single-file build (db + logic + charts + app)
   Vanilla JS, zero deps, offline-first (IndexedDB).
   ============================================================ */

/* ---- DB: IndexedDB layer ---- */
const DB = (() => {
  const NAME = 'gymtracker';
  const VERSION = 1;
  let _db = null;

  const uid = (p = '') =>
    p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('exercises')) {
          const s = db.createObjectStore('exercises', { keyPath: 'id' });
          s.createIndex('muscleGroup', 'muscleGroup', { unique: false });
          s.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('workouts')) {
          const s = db.createObjectStore('workouts', { keyPath: 'id' });
          s.createIndex('status', 'status', { unique: false });
          s.createIndex('date', 'date', { unique: false });
          s.createIndex('startTime', 'startTime', { unique: false });
        }
        if (!db.objectStoreNames.contains('sets')) {
          const s = db.createObjectStore('sets', { keyPath: 'id' });
          s.createIndex('workoutId', 'workoutId', { unique: false });
          s.createIndex('exerciseId', 'exerciseId', { unique: false });
        }
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('goals')) {
          const s = db.createObjectStore('goals', { keyPath: 'id' });
          s.createIndex('exerciseId', 'exerciseId', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return _db.transaction(store, mode).objectStore(store);
  }
  const p = (req) => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  // generic CRUD
  const put = (store, obj) => p(tx(store, 'readwrite').put(obj)).then(() => obj);
  const get = (store, key) => p(tx(store).get(key));
  const del = (store, key) => p(tx(store, 'readwrite').delete(key));
  const all = (store) => p(tx(store).getAll());
  const byIndex = (store, index, val) =>
    p(tx(store).index(index).getAll(IDBKeyRange.only(val)));

  // ---- meta helpers ----
  const metaGet = (key, def = null) =>
    get('meta', key).then(r => (r ? r.value : def));
  const metaSet = (key, value) => put('meta', { key, value });

  // ---- default exercise library (PPL-oriented) ----
  const SEED = [
    // Push
    ['Bankdrücken (LH)', 'chest', 'compound', [6, 8]],
    ['Schrägbankdrücken (KH)', 'chest', 'compound', [8, 12]],
    ['Dips', 'chest', 'compound', [8, 12]],
    ['Butterfly', 'chest', 'isolation', [12, 15]],
    ['Schulterdrücken (KH)', 'shoulders', 'compound', [8, 12]],
    ['Seitheben', 'shoulders', 'isolation', [12, 20]],
    ['Trizeps Pushdown', 'triceps', 'isolation', [10, 15]],
    ['Overhead Trizeps', 'triceps', 'isolation', [10, 15]],
    // Pull
    ['Kreuzheben', 'back', 'compound', [4, 6]],
    ['Klimmzüge', 'back', 'compound', [6, 10]],
    ['Rudern vorgebeugt (LH)', 'back', 'compound', [8, 12]],
    ['Latzug', 'back', 'compound', [10, 12]],
    ['Face Pull', 'shoulders', 'isolation', [15, 20]],
    ['Bizeps Curl (KH)', 'biceps', 'isolation', [8, 12]],
    ['Hammer Curl', 'biceps', 'isolation', [10, 12]],
    // Legs
    ['Kniebeuge', 'legs', 'compound', [5, 8]],
    ['Beinpresse', 'legs', 'compound', [10, 15]],
    ['Rumänisches Kreuzheben', 'legs', 'compound', [8, 10]],
    ['Beinbeuger', 'legs', 'isolation', [10, 15]],
    ['Beinstrecker', 'legs', 'isolation', [12, 15]],
    ['Wadenheben', 'legs', 'isolation', [12, 20]],
    ['Bauch (Crunch Maschine)', 'core', 'isolation', [12, 20]],
  ];

  async function seedIfEmpty() {
    const existing = await all('exercises');
    if (existing.length) return;
    for (const [name, mg, cat, range] of SEED) {
      await put('exercises', {
        id: uid('ex_'), name, muscleGroup: mg, category: cat,
        defaultRepRange: { min: range[0], max: range[1] },
        createdAt: Date.now(), notes: '',
      });
    }
    await metaSet('seeded', true);
  }

  let _initPromise = null;
  async function init() {
    if (_initPromise) return _initPromise;   // idempotent — never seed twice
    _initPromise = (async () => {
      await open();
      await seedIfEmpty();
      return _db;
    })();
    return _initPromise;
  }

  // export / import (local-first backup — no cloud, so this matters)
  async function exportAll() {
    const data = {};
    for (const s of ['exercises', 'workouts', 'sets', 'templates', 'goals', 'meta']) {
      data[s] = await all(s);
    }
    return { app: 'gymtracker', version: VERSION, exportedAt: Date.now(), data };
  }
  async function importAll(bundle, { merge = false } = {}) {
    const d = bundle.data || {};
    for (const s of ['exercises', 'workouts', 'sets', 'templates', 'goals', 'meta']) {
      if (!merge) {
        await p(tx(s, 'readwrite').clear());
      }
      for (const obj of (d[s] || [])) await put(s, obj);
    }
  }

  return {
    uid, init, put, get, del, all, byIndex,
    metaGet, metaSet, exportAll, importAll,
    MUSCLE_GROUPS: ['chest', 'back', 'shoulders', 'legs', 'biceps', 'triceps', 'core'],
    MG_LABEL: {
      chest: 'Brust', back: 'Rücken', shoulders: 'Schultern', legs: 'Beine',
      biceps: 'Bizeps', triceps: 'Trizeps', core: 'Core',
    },
  };
})();

/* ---- LOGIC: training maths (e1RM, PR, progression) ---- */
const Logic = (() => {

  // Epley estimated 1RM. reps=1 -> weight.
  const e1rm = (weight, reps) =>
    reps <= 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10;

  const volume = (weight, reps) => weight * reps;

  const isWorking = (s) => s.setType === 'working' || s.setType === 'failure' || !s.setType;

  // ---- Personal-record detection ----------------------------------
  // Compares a candidate set against the exercise's prior working sets.
  // Returns the list of PR types the set beats. Never mutates anything.
  function detectPRs(candidate, priorSets) {
    const flags = [];
    const prior = priorSets.filter(isWorking);
    if (!isWorking(candidate)) return flags;

    const w = candidate.weight, r = candidate.reps;
    const maxW = Math.max(0, ...prior.map(s => s.weight));
    if (w > maxW) flags.push('weight');              // heaviest weight ever

    const atSame = prior.filter(s => s.weight === w).map(s => s.reps);
    const maxRepsAtW = Math.max(0, ...atSame);
    // only a "reps at same weight" PR if that weight was trained before
    if (atSame.length && r > maxRepsAtW) flags.push('reps');

    const maxVol = Math.max(0, ...prior.map(s => volume(s.weight, s.reps)));
    if (volume(w, r) > maxVol) flags.push('volume'); // best single-set volume

    const maxE = Math.max(0, ...prior.map(s => e1rm(s.weight, s.reps)));
    if (e1rm(w, r) > maxE) flags.push('e1rm');       // best estimated 1RM

    return flags;
  }

  const PR_LABEL = {
    weight: 'Neues Top-Gewicht',
    reps: 'Meiste Wdh. bei dem Gewicht',
    volume: 'Bestes Satz-Volumen',
    e1rm: 'Bester geschätzter 1RM',
  };

  // ---- Progression hint (suggestion only, never forced) -----------
  // If the last N working sets of an exercise are at/above the top of
  // the target rep range, surface a *hint*. The user decides.
  function progressionHint(exercise, workingSetsThisAndLast) {
    const range = exercise.defaultRepRange;
    if (!range) return null;
    const top = Math.max(range.min, range.max);
    const recent = workingSetsThisAndLast.slice(-3);
    if (recent.length < 2) return null;
    const allAtTop = recent.every(s => s.reps >= top);
    if (!allAtTop) return null;
    const sameWeight = recent.every(s => s.weight === recent[0].weight);
    return {
      type: 'progress',
      weight: recent[0].weight,
      text: sameWeight
        ? `Du triffst bei ${recent[0].weight} kg mehrfach das obere Ende (${top} Wdh.). Nächstes Mal Gewicht erhöhen wäre eine Option — deine Entscheidung.`
        : `Du landest zuletzt am oberen Ende des Zielbereichs (${top} Wdh.). Gewicht anzuziehen wäre eine Option — deine Entscheidung.`,
    };
  }

  // ---- Workout roll-up --------------------------------------------
  function summarizeWorkout(sets) {
    const working = sets.filter(isWorking);
    return {
      totalSets: sets.length,
      workingSets: working.length,
      totalVolume: Math.round(sets.reduce((a, s) => a + volume(s.weight, s.reps), 0)),
      prCount: sets.reduce((a, s) => a + (s.prFlags ? s.prFlags.length : 0), 0),
    };
  }

  // ---- Best-set-per-exercise for history --------------------------
  function bestSet(sets) {
    let best = null, bestE = -1;
    for (const s of sets.filter(isWorking)) {
      const e = e1rm(s.weight, s.reps);
      if (e > bestE) { bestE = e; best = s; }
    }
    return best;
  }

  // ---- Time series for charts -------------------------------------
  // Given all sets of one exercise (+ their workout dates), produce
  // one point per workout: top e1RM, top weight, total volume, top reps.
  function exerciseSeries(sets, workoutMap) {
    const byWorkout = {};
    for (const s of sets) {
      if (!isWorking(s)) continue;
      (byWorkout[s.workoutId] ||= []).push(s);
    }
    const rows = Object.entries(byWorkout).map(([wid, arr]) => {
      const wo = workoutMap[wid];
      return {
        date: wo ? (wo.date || wo.startTime) : 0,
        e1rm: Math.max(...arr.map(s => e1rm(s.weight, s.reps))),
        topWeight: Math.max(...arr.map(s => s.weight)),
        topReps: Math.max(...arr.map(s => s.reps)),
        volume: arr.reduce((a, s) => a + volume(s.weight, s.reps), 0),
      };
    });
    return rows.sort((a, b) => a.date - b.date);
  }

  // sets per muscle group over a window (for weekly volume balance)
  function setsPerMuscle(sets, exerciseMap, sinceTs) {
    const out = {};
    for (const s of sets) {
      if (sinceTs && s.timestamp < sinceTs) continue;
      const ex = exerciseMap[s.exerciseId];
      if (!ex) continue;
      out[ex.muscleGroup] = (out[ex.muscleGroup] || 0) + (isWorking(s) ? 1 : 0);
    }
    return out;
  }

  return {
    e1rm, volume, isWorking, detectPRs, PR_LABEL,
    progressionHint, summarizeWorkout, bestSet,
    exerciseSeries, setsPerMuscle,
  };
})();

/* ---- CHARTS: hand-rolled inline SVG ---- */
const Charts = (() => {
  const W = 320, H = 150, PAD_L = 34, PAD_R = 8, PAD_T = 10, PAD_B = 22;

  const defs = `<defs>
    <linearGradient id="g-up" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--up)"/>
      <stop offset="100%" stop-color="var(--up)" stop-opacity="0"/>
    </linearGradient></defs>`;

  function line(points, opts = {}) {
    // points: [{x:tsOrIndex, y:number}]
    if (!points.length) return empty(opts.emptyText || 'Noch keine Daten');
    if (points.length === 1) points = [points[0], { ...points[0] }]; // draw a flat segment

    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yPad = (yMax - yMin) * 0.12; yMin -= yPad; yMax += yPad;

    const sx = (x) => PAD_L + (xMax === xMin ? 0.5 : (x - xMin) / (xMax - xMin)) * (W - PAD_L - PAD_R);
    const sy = (y) => PAD_T + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);

    const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    const area = `M${sx(points[0].x).toFixed(1)},${(H - PAD_B)} `
      + points.map(p => `L${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')
      + ` L${sx(points[points.length - 1].x).toFixed(1)},${(H - PAD_B)} Z`;

    // y grid (3 lines)
    let grid = '';
    for (let i = 0; i <= 2; i++) {
      const yv = yMin + (yMax - yMin) * (i / 2);
      const y = sy(yv).toFixed(1);
      grid += `<line class="grid" x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}"/>`;
      grid += `<text class="axis" x="2" y="${(+y + 3)}">${fmt(yv)}</text>`;
    }
    const last = points[points.length - 1];
    const dot = `<circle class="dot" cx="${sx(last.x).toFixed(1)}" cy="${sy(last.y).toFixed(1)}" r="3.5"/>`;

    return svg(`${grid}<path class="area" d="${area}"/><path class="linepath" d="${path}"/>${dot}`);
  }

  function bars(items, opts = {}) {
    // items: [{label, value}]
    if (!items.length) return empty(opts.emptyText || 'Noch keine Daten');
    const max = Math.max(...items.map(i => i.value), 1);
    const n = items.length;
    const gap = 10;
    const bw = (W - PAD_L - PAD_R - gap * (n - 1)) / n;
    let out = '';
    items.forEach((it, i) => {
      const h = (it.value / max) * (H - PAD_T - PAD_B);
      const x = PAD_L + i * (bw + gap);
      const y = H - PAD_B - h;
      out += `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="4"/>`;
      out += `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${it.label}</text>`;
      out += `<text class="axis" x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${it.value}</text>`;
    });
    return svg(out);
  }

  function svg(inner) {
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${defs}${inner}</svg>`;
  }
  function empty(t) {
    return `<svg class="chart" viewBox="0 0 ${W} ${H}"><text class="axis" x="${W / 2}" y="${H / 2}" text-anchor="middle" style="font-size:12px">${t}</text></svg>`;
  }
  function fmt(v) {
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
    return Math.round(v * 10) / 10;
  }

  return { line, bars };
})();

/* ---- APP: UI controller + live workout ---- */
const App = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------- global runtime state -------
  const S = {
    view: 'home',
    active: null,          // active workout object
    order: [],             // [exerciseId] in this workout
    curEx: null,           // current exerciseId in live mode
    setsByEx: {},          // { exerciseId: [set,...] } for active workout
    entry: { weight: 20, reps: 8, rir: 2, setType: 'working' },
    rest: { t: 0, iv: null, total: 0 },
    exCache: {},           // id -> exercise
    startFromTemplate: null,
  };

  // ---------- helpers ----------
  const vibrate = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
  function toast(msg, pr = false) {
    const t = $('toast'); t.textContent = msg; t.className = pr ? 'show pr' : 'show';
    clearTimeout(t._t); t._t = setTimeout(() => (t.className = ''), 1900);
  }
  const pad = (n) => String(n).padStart(2, '0');
  function clock(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${pad(s)}`;
  }
  function dur(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)}h ${pad(min % 60)}min`;
  }
  const today = () => new Date().toISOString().slice(0, 10);
  function dateLabel(d) {
    if (!d) return '';
    const dt = typeof d === 'string' ? new Date(d + 'T00:00') : new Date(d);
    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const diff = Math.round((t - new Date(dt).setHours(0, 0, 0, 0)) / 86400000);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Gestern';
    return `${days[dt.getDay()]}, ${dt.getDate()}.${dt.getMonth() + 1}.`;
  }

  async function loadExCache() {
    const all = await DB.all('exercises');
    S.exCache = {}; all.forEach(e => S.exCache[e.id] = e);
    return all;
  }
  const ex = (id) => S.exCache[id];

  // ==========================================================
  //  ROUTER
  // ==========================================================
  function go(view) {
    S.view = view;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    window.scrollTo(0, 0);
    render(view);
  }
  function render(view) {
    if (view === 'home') renderHome();
    else if (view === 'exercises') renderExercises();
    else if (view === 'history') renderHistory();
    else if (view === 'stats') renderStats();
    else if (view === 'live') renderLive();
  }

  // ==========================================================
  //  HOME
  // ==========================================================
  async function renderHome() {
    const workouts = (await DB.all('workouts'));
    const done = workouts.filter(w => w.status === 'completed').sort((a, b) => b.startTime - a.startTime);
    const goals = await DB.all('goals');
    const weekAgo = Date.now() - 7 * 86400000;
    const thisWeek = done.filter(w => w.startTime >= weekAgo);
    const active = workouts.find(w => w.status === 'active');

    let html = `
      <div class="metric-grid">
        <div class="metric"><div class="k">Diese Woche</div><div class="v num">${thisWeek.length}</div><div class="d muted">Workouts</div></div>
        <div class="metric"><div class="k">Volumen 7T</div><div class="v num">${fmtK(thisWeek.reduce((a, w) => a + (w.totalVolume || 0), 0))}</div><div class="d muted">kg gesamt</div></div>
      </div>`;

    if (active) {
      html += `<div class="card" style="border-color:var(--up)">
        <div class="row between"><div><div style="font-weight:800;font-size:17px">Laufendes Workout</div>
        <div class="muted tiny">gestartet ${new Date(active.startTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div></div>
        <button class="btn up" onclick="App.resumeWorkout()">Weiter</button></div></div>`;
    }

    html += `<button class="btn up block lg" onclick="App.startWorkout()" style="margin:6px 0 4px">Workout starten</button>
             <div class="row" style="gap:10px;margin-bottom:8px">
               <button class="btn ghost block" onclick="App.openTemplates()">Aus Vorlage</button>
               <button class="btn ghost block" onclick="App.go('exercises')">Übungen</button>
             </div>`;

    // goals
    if (goals.length) {
      html += `<h2 class="section">Ziele</h2>`;
      for (const g of goals) html += goalCard(g);
    }

    html += `<h2 class="section">Letzte Workouts</h2>`;
    if (!done.length) {
      html += `<div class="empty"><div class="big">Noch kein Training geloggt</div>Starte dein erstes Workout — Sätze werden lokal auf dem Gerät gespeichert.</div>`;
    } else {
      for (const w of done.slice(0, 6)) html += workoutRow(w);
    }
    $('view-home').innerHTML = html;
  }

  function goalCard(g) {
    const pct = g.target ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
    return `<div class="card tap" onclick="App.editGoal('${g.id}')">
      <div class="row between"><div style="font-weight:700">${esc(g.label)}</div>
      <div class="num" style="font-weight:800">${g.current}/${g.target} ${esc(g.unit || '')}</div></div>
      <div style="height:8px;border-radius:4px;background:var(--surface-3);margin-top:10px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--up)"></div></div></div>`;
  }

  function workoutRow(w) {
    const pr = w.prCount ? `<span class="pill pr">${w.prCount} PR</span>` : '';
    return `<div class="card tap" onclick="App.openWorkout('${w.id}')">
      <div class="row between">
        <div><div style="font-weight:700;font-size:16px">${esc(w.name || 'Workout')}</div>
        <div class="muted tiny">${dateLabel(w.date)} · ${dur(w.duration || 0)}</div></div>
        ${pr}
      </div>
      <div class="row" style="gap:16px;margin-top:10px">
        <span class="tiny muted">${w.totalSets || 0} Sätze</span>
        <span class="tiny muted num">${fmtK(w.totalVolume || 0)} kg</span>
      </div></div>`;
  }
  const fmtK = (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);

  // ==========================================================
  //  LIVE WORKOUT  (core)
  // ==========================================================
  async function startWorkout() {
    await loadExCache();
    const w = {
      id: DB.uid('w_'), name: defaultWorkoutName(), startTime: Date.now(),
      endTime: null, duration: 0, date: today(), templateId: S.startFromTemplate,
      notes: '', status: 'active', exerciseOrder: [],
      totalSets: 0, totalVolume: 0, prCount: 0,
    };
    await DB.put('workouts', w);
    S.active = w; S.order = []; S.curEx = null; S.setsByEx = {};

    // preload from template
    if (S.startFromTemplate) {
      const tpl = await DB.get('templates', S.startFromTemplate);
      if (tpl) { for (const e of tpl.exercises) await addExercise(e.exerciseId, false); }
      S.startFromTemplate = null;
    }
    go('live');
    if (!S.order.length) openExercisePicker();
  }
  function defaultWorkoutName() {
    const h = new Date().getHours();
    return h < 11 ? 'Morgen-Session' : h < 17 ? 'Training' : 'Abend-Session';
  }
  async function resumeWorkout() {
    await loadExCache();
    const w = (await DB.all('workouts')).find(x => x.status === 'active');
    if (!w) return renderHome();
    S.active = w; S.order = w.exerciseOrder || [];
    S.setsByEx = {};
    const sets = await DB.byIndex('sets', 'workoutId', w.id);
    for (const s of sets) (S.setsByEx[s.exerciseId] ||= []).push(s);
    S.curEx = S.order[S.order.length - 1] || null;
    if (S.curEx) prefillFromLast(S.curEx);
    go('live');
    if (!S.order.length) openExercisePicker();
  }

  function renderLive() {
    if (!S.active) { go('home'); return; }
    const elapsed = Date.now() - S.active.startTime;
    let html = `
      <div class="live-head">
        <button class="btn ghost" style="min-height:40px;padding:0 14px" onclick="App.minimizeWorkout()">‹ Fertig? nein</button>
        <div class="live-timer">Dauer <span class="num" id="liveDur">${dur(elapsed)}</span></div>
        <button class="btn up" style="min-height:40px;padding:0 16px" onclick="App.finishWorkout()">Beenden</button>
      </div>
      <div class="ex-switch" id="exSwitch">${exSwitchHTML()}</div>
      <div class="live-body" id="liveBody">${liveBodyHTML()}</div>`;
    $('view-live').innerHTML = html;
    startLiveTimer();
  }

  function exSwitchHTML() {
    let html = '';
    S.order.forEach(id => {
      const e = ex(id); if (!e) return;
      const n = (S.setsByEx[id] || []).filter(Logic.isWorking).length;
      html += `<button class="ex-tab ${id === S.curEx ? 'active' : ''}" onclick="App.selectEx('${id}')">
        <span class="mg">${DB.MG_LABEL[e.muscleGroup]}</span>${esc(e.name)}
        <span class="mg">${n} Sätze</span></button>`;
    });
    html += `<button class="ex-tab add" onclick="App.openExercisePicker()">＋</button>`;
    return html;
  }

  function liveBodyHTML() {
    if (!S.curEx) {
      return `<div class="empty"><div class="big">Übung hinzufügen</div>Tippe ＋ oben, um deine erste Übung zu wählen.</div>`;
    }
    const e = ex(S.curEx);
    const sets = S.setsByEx[S.curEx] || [];
    const hintHTML = renderHintHTML(S.curEx);

    let logs = '';
    sets.forEach((s, i) => {
      const idx = Logic.isWorking(s) ? (sets.slice(0, i + 1).filter(Logic.isWorking).length) : 'W';
      const prs = (s.prFlags || []);
      const cls = ['set-line', s.setType === 'warmup' ? 'warmup' : '', prs.length ? 'pr' : ''].join(' ');
      const prPill = prs.length ? `<span class="pill pr">PR</span>` : '';
      logs += `<div class="${cls}">
        <div class="set-idx">${idx}</div>
        <div><div class="set-main num">${s.weight} kg × ${s.reps}</div>
        <div class="set-sub">RIR ${s.rir}${s.setType !== 'working' ? ' · ' + setTypeLabel(s.setType) : ''} · e1RM ${Logic.e1rm(s.weight, s.reps)}</div></div>
        <div class="row" style="gap:8px">${prPill}
        <button onclick="App.deleteSet('${s.id}')" style="color:var(--text-3);padding:8px">✕</button></div></div>`;
    });

    const en = S.entry;
    return `
      <div class="cur-ex-name">${esc(e.name)}</div>
      <div class="muted tiny">${DB.MG_LABEL[e.muscleGroup]} · Ziel ${e.defaultRepRange.min}–${e.defaultRepRange.max} Wdh.</div>
      ${hintHTML}
      <div class="set-log">${logs || '<div class="muted tiny" style="padding:8px 2px">Noch keine Sätze — trag den ersten ein.</div>'}</div>

      <div class="entry">
        <div class="entry-grid">
          ${stepper('weight', 'Gewicht', en.weight, 'kg')}
          ${stepper('reps', 'Wdh.', en.reps, '')}
          ${stepper('rir', 'RIR', en.rir, 'in Reserve')}
        </div>
        <div class="settype-row">
          ${setChip('working', 'Arbeitssatz')}
          ${setChip('warmup', 'Aufwärmen')}
          ${setChip('dropset', 'Dropset')}
        </div>
      </div>
      <div class="save-bar">
        <button class="btn ghost" style="flex:0 0 auto;padding:0 18px" onclick="App.repeatLast()">↺</button>
        <button class="btn up block lg" onclick="App.saveSet()">Satz speichern</button>
      </div>`;
  }

  function stepper(key, label, val, unit) {
    const step = key === 'weight' ? 2.5 : 1;
    return `<div class="field"><label>${label}</label>
      <div class="stepper">
        <button onclick="App.step('${key}',-${step})">–</button>
        <input class="num" inputmode="decimal" id="in_${key}" value="${val}" onchange="App.setEntry('${key}', this.value)">
        <button onclick="App.step('${key}',${step})">＋</button>
      </div><div class="unit">${unit || '&nbsp;'}</div></div>`;
  }
  function setChip(type, label) {
    return `<button class="chip ${S.entry.setType === type ? 'active' : ''}" onclick="App.setType('${type}')">${label}</button>`;
  }
  const setTypeLabel = (t) => ({ working: 'Arbeit', warmup: 'Aufwärmen', dropset: 'Dropset', failure: 'Failure' }[t] || t);

  function step(key, delta) {
    let v = (S.entry[key] || 0) + delta;
    if (key === 'reps' || key === 'rir') v = Math.max(0, Math.round(v));
    if (key === 'weight') v = Math.max(0, Math.round(v * 2) / 2);
    S.entry[key] = v;
    const inp = $('in_' + key); if (inp) inp.value = v;
    vibrate(8);
  }
  function setEntry(key, val) {
    let v = parseFloat(String(val).replace(',', '.'));
    if (isNaN(v)) v = 0;
    S.entry[key] = key === 'weight' ? Math.max(0, v) : Math.max(0, Math.round(v));
  }
  function setType(t) { S.entry.setType = t; refreshLiveBody(); }

  function selectEx(id) {
    S.curEx = id; prefillFromLast(id);
    refreshExSwitch(); refreshLiveBody();
  }
  async function prefillFromLast(id) {
    // last working set of this exercise (this workout, else historical)
    const here = (S.setsByEx[id] || []).filter(Logic.isWorking);
    let src = here[here.length - 1];
    if (!src) {
      const hist = (await DB.byIndex('sets', 'exerciseId', id)).filter(Logic.isWorking);
      src = hist.sort((a, b) => b.timestamp - a.timestamp)[0];
    }
    if (src) S.entry = { weight: src.weight, reps: src.reps, rir: src.rir, setType: 'working' };
    else {
      const e = ex(id);
      S.entry = { weight: 20, reps: e ? e.defaultRepRange.max : 8, rir: 2, setType: 'working' };
    }
  }
  function repeatLast() {
    const here = (S.setsByEx[S.curEx] || []).filter(Logic.isWorking);
    const last = here[here.length - 1];
    if (last) { S.entry = { weight: last.weight, reps: last.reps, rir: last.rir, setType: 'working' }; refreshLiveBody(); toast('Letzten Satz übernommen'); }
  }

  async function saveSet() {
    if (!S.curEx) return;
    const en = S.entry;
    if (!en.reps) { toast('Wiederholungen fehlen'); return; }

    // read prior working sets across ALL history for PR detection
    const priorAll = (await DB.byIndex('sets', 'exerciseId', S.curEx));
    const prFlags = Logic.detectPRs({ ...en }, priorAll);

    const set = {
      id: DB.uid('s_'), workoutId: S.active.id, exerciseId: S.curEx,
      weight: en.weight, reps: en.reps, rir: en.rir, rpe: null,
      setType: en.setType, timestamp: Date.now(), note: '',
      e1rm: Logic.e1rm(en.weight, en.reps), prFlags,
    };
    await DB.put('sets', set);
    (S.setsByEx[S.curEx] ||= []).push(set);

    // roll up workout totals
    await recalcWorkout();

    // feedback
    if (prFlags.length) {
      toast('🏆 ' + Logic.PR_LABEL[prFlags[0]], true); vibrate([20, 40, 20]);
    } else { vibrate(12); }

    // auto rest timer + auto-advance to next set (same values pre-filled)
    startRest(en.setType === 'warmup' ? 45 : 120);

    refreshExSwitch(); refreshLiveBody();
  }

  async function deleteSet(id) {
    await DB.del('sets', id);
    for (const k in S.setsByEx) S.setsByEx[k] = S.setsByEx[k].filter(s => s.id !== id);
    await recalcWorkout();
    refreshExSwitch(); refreshLiveBody();
  }

  async function recalcWorkout() {
    const sets = [];
    for (const k in S.setsByEx) sets.push(...S.setsByEx[k]);
    const sum = Logic.summarizeWorkout(sets);
    Object.assign(S.active, {
      totalSets: sum.totalSets, totalVolume: sum.totalVolume,
      prCount: sum.prCount, exerciseOrder: S.order,
    });
    await DB.put('workouts', S.active);
  }

  function renderHintHTML(id) {
    const e = ex(id);
    // combine this workout's working sets with last session's for the same exercise
    const here = (S.setsByEx[id] || []).filter(Logic.isWorking);
    const hint = Logic.progressionHint(e, here);
    if (!hint) return '';
    return `<div class="hint"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3v12m0 0l4-4m-4 4l-4-4"/><path d="M5 21h14"/></svg>
      <div class="txt">${esc(hint.text)}</div></div>`;
  }

  function refreshLiveBody() { const b = $('liveBody'); if (b) b.innerHTML = liveBodyHTML(); }
  function refreshExSwitch() { const s = $('exSwitch'); if (s) s.innerHTML = exSwitchHTML(); }

  // ---- live timer ----
  function startLiveTimer() {
    stopLiveTimer();
    S._liveIv = setInterval(() => {
      const el = $('liveDur');
      if (!el || !S.active) return stopLiveTimer();
      el.textContent = dur(Date.now() - S.active.startTime);
    }, 15000);
  }
  function stopLiveTimer() { if (S._liveIv) clearInterval(S._liveIv); S._liveIv = null; }

  // ---- rest timer ----
  function startRest(sec) {
    S.rest.total = sec; S.rest.t = sec;
    const strip = $('restStrip'); strip.classList.add('show');
    renderRest();
    if (S.rest.iv) clearInterval(S.rest.iv);
    S.rest.iv = setInterval(() => {
      S.rest.t--;
      if (S.rest.t <= 0) { finishRest(); return; }
      renderRest();
    }, 1000);
  }
  function renderRest() {
    const strip = $('restStrip');
    strip.classList.toggle('warn', S.rest.t <= 10);
    $('restT').textContent = clock(S.rest.t);
  }
  function addRest(d) { S.rest.t = Math.max(1, S.rest.t + d); renderRest(); }
  function finishRest() {
    if (S.rest.iv) clearInterval(S.rest.iv);
    S.rest.iv = null;
    vibrate([30, 60, 30]);
    const strip = $('restStrip'); strip.classList.remove('warn');
    $('restT').textContent = 'Los!';
    setTimeout(() => strip.classList.remove('show'), 1200);
  }
  function skipRest() { if (S.rest.iv) clearInterval(S.rest.iv); $('restStrip').classList.remove('show'); }

  function minimizeWorkout() { toast('Workout läuft weiter'); go('home'); }

  async function finishWorkout() {
    if (!S.active) return;
    const total = [];
    for (const k in S.setsByEx) total.push(...S.setsByEx[k]);
    if (!total.length) {
      if (!confirm('Keine Sätze geloggt. Workout verwerfen?')) return;
      await DB.del('workouts', S.active.id);
      S.active = null; stopLiveTimer(); skipRest(); go('home'); return;
    }
    S.active.endTime = Date.now();
    S.active.duration = S.active.endTime - S.active.startTime;
    S.active.status = 'completed';
    await recalcWorkout();
    await updateGoalsAfterWorkout();
    const prc = S.active.prCount;
    stopLiveTimer(); skipRest();
    S.active = null;
    toast(prc ? `Gespeichert · ${prc} neue PRs 🏆` : 'Workout gespeichert', prc > 0);
    go('home');
  }

  // ==========================================================
  //  EXERCISE PICKER (sheet)
  // ==========================================================
  async function openExercisePicker() {
    await loadExCache();
    const all = Object.values(S.exCache).sort((a, b) => a.name.localeCompare(b.name));
    const groups = {};
    for (const e of all) (groups[e.muscleGroup] ||= []).push(e);
    let html = `<div class="grab"></div><h3>Übung hinzufügen</h3>
      <input class="text-in" placeholder="Suchen…" oninput="App.filterPicker(this.value)" style="margin-bottom:12px">
      <div id="pickerList">`;
    for (const mg of DB.MUSCLE_GROUPS) {
      if (!groups[mg]) continue;
      html += `<div class="eyebrow" style="margin:14px 4px 6px">${DB.MG_LABEL[mg]}</div>`;
      for (const e of groups[mg]) {
        const inWo = S.order.includes(e.id);
        html += `<div class="list-item" data-name="${esc(e.name.toLowerCase())}" onclick="App.pickExercise('${e.id}')">
          <div><div class="name">${esc(e.name)}</div><div class="mg">Ziel ${e.defaultRepRange.min}–${e.defaultRepRange.max} · ${e.category === 'compound' ? 'Grundübung' : 'Isolation'}</div></div>
          <div class="pill ${inWo ? 'up' : ''}">${inWo ? '✓ dabei' : '＋'}</div></div>`;
      }
    }
    html += `</div><button class="btn ghost block" style="margin-top:14px" onclick="App.openNewExercise()">Neue Übung erstellen</button>`;
    openSheet(html);
  }
  function filterPicker(q) {
    q = q.toLowerCase();
    document.querySelectorAll('#pickerList .list-item').forEach(li => {
      li.style.display = li.dataset.name.includes(q) ? '' : 'none';
    });
    document.querySelectorAll('#pickerList .eyebrow').forEach(e => e.style.display = q ? 'none' : '');
  }
  async function pickExercise(id) {
    await addExercise(id, true);
    closeSheet();
  }
  async function addExercise(id, select) {
    if (!S.order.includes(id)) S.order.push(id);
    if (select || !S.curEx) { S.curEx = id; await prefillFromLast(id); }
    if (S.active) { S.active.exerciseOrder = S.order; await DB.put('workouts', S.active); }
    if (S.view === 'live') { refreshExSwitch(); refreshLiveBody(); }
  }

  // ---- create new exercise ----
  function openNewExercise() {
    let opts = DB.MUSCLE_GROUPS.map(m => `<option value="${m}">${DB.MG_LABEL[m]}</option>`).join('');
    const html = `<div class="grab"></div><h3>Neue Übung</h3>
      <input class="text-in" id="nx_name" placeholder="Name (z.B. Frontdrücken)" style="margin-bottom:10px">
      <select class="text-in" id="nx_mg" style="margin-bottom:10px">${opts}</select>
      <div class="row" style="gap:10px;margin-bottom:12px">
        <input class="text-in num" id="nx_min" inputmode="numeric" placeholder="Min Wdh." value="8">
        <input class="text-in num" id="nx_max" inputmode="numeric" placeholder="Max Wdh." value="12">
      </div>
      <button class="btn up block" onclick="App.saveNewExercise()">Erstellen</button>`;
    openSheet(html);
  }
  async function saveNewExercise() {
    const name = $('nx_name').value.trim();
    if (!name) { toast('Name fehlt'); return; }
    const e = {
      id: DB.uid('ex_'), name, muscleGroup: $('nx_mg').value, category: 'compound',
      defaultRepRange: { min: +$('nx_min').value || 8, max: +$('nx_max').value || 12 },
      createdAt: Date.now(), notes: '',
    };
    await DB.put('exercises', e); S.exCache[e.id] = e;
    closeSheet();
    if (S.view === 'live') { await addExercise(e.id, true); }
    else if (S.view === 'exercises') renderExercises();
    toast('Übung erstellt');
  }

  // ==========================================================
  //  EXERCISES VIEW
  // ==========================================================
  let exFilter = 'all';
  async function renderExercises() {
    await loadExCache();
    const all = Object.values(S.exCache);
    const sets = await DB.all('sets');
    const usage = {}; sets.forEach(s => usage[s.exerciseId] = (usage[s.exerciseId] || 0) + 1);

    let chips = `<button class="chip ${exFilter === 'all' ? 'active' : ''}" onclick="App.setExFilter('all')">Alle</button>`;
    chips += DB.MUSCLE_GROUPS.map(m => `<button class="chip ${exFilter === m ? 'active' : ''}" onclick="App.setExFilter('${m}')">${DB.MG_LABEL[m]}</button>`).join('');

    const list = all
      .filter(e => exFilter === 'all' || e.muscleGroup === exFilter)
      .sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.name.localeCompare(b.name));

    let rows = '';
    for (const e of list) {
      rows += `<div class="card tap" onclick="App.openExercise('${e.id}')">
        <div class="row between"><div><div style="font-weight:700">${esc(e.name)}</div>
        <div class="muted tiny">${DB.MG_LABEL[e.muscleGroup]} · Ziel ${e.defaultRepRange.min}–${e.defaultRepRange.max}</div></div>
        <div class="pill">${usage[e.id] || 0} Sätze</div></div></div>`;
    }
    $('view-exercises').innerHTML = `
      <div class="chiprow">${chips}</div>
      ${rows || '<div class="empty">Keine Übungen in dieser Gruppe.</div>'}
      <button class="btn ghost block" style="margin-top:8px" onclick="App.openNewExercise()">Neue Übung erstellen</button>`;
  }
  function setExFilter(f) { exFilter = f; renderExercises(); }

  // exercise detail = history + charts
  async function openExercise(id) {
    await loadExCache();
    const e = ex(id);
    const sets = (await DB.byIndex('sets', 'exerciseId', id));
    const workouts = await DB.all('workouts');
    const wmap = {}; workouts.forEach(w => wmap[w.id] = w);
    const series = Logic.exerciseSeries(sets, wmap);

    // group history by workout
    const byW = {};
    sets.forEach(s => (byW[s.workoutId] ||= []).push(s));
    const hist = Object.entries(byW)
      .map(([wid, arr]) => ({ w: wmap[wid], arr }))
      .filter(x => x.w).sort((a, b) => b.w.startTime - a.w.startTime);

    const best = Logic.bestSet(sets);
    const bestLine = best ? `${best.weight} kg × ${best.reps} (e1RM ${Logic.e1rm(best.weight, best.reps)})` : '—';

    let charts = '';
    if (series.length) {
      charts = chartCard('Geschätzter 1RM', series.map(r => ({ x: r.date, y: r.e1rm })), 'kg', series[series.length - 1].e1rm)
             + chartCard('Top-Gewicht', series.map(r => ({ x: r.date, y: r.topWeight })), 'kg', series[series.length - 1].topWeight)
             + chartCard('Volumen / Session', series.map(r => ({ x: r.date, y: r.volume })), 'kg', series[series.length - 1].volume);
    }

    let histHTML = '';
    for (const { w, arr } of hist.slice(0, 12)) {
      const lines = arr.map(s => `<span class="num" style="margin-right:12px">${s.weight}×${s.reps}${s.prFlags && s.prFlags.length ? ' 🏆' : ''}</span>`).join('');
      histHTML += `<div class="card"><div class="muted tiny" style="margin-bottom:6px">${dateLabel(w.date)}</div><div>${lines}</div></div>`;
    }

    const html = `<div class="grab"></div><h3>${esc(e.name)}</h3>
      <div class="metric-grid" style="margin-bottom:12px">
        <div class="metric"><div class="k">Bester Satz</div><div class="v num" style="font-size:18px">${bestLine}</div></div>
        <div class="metric"><div class="k">Sätze gesamt</div><div class="v num">${sets.length}</div></div>
      </div>
      ${charts || '<div class="empty tiny">Noch keine Trainingsdaten für Charts.</div>'}
      <h2 class="section">Verlauf</h2>${histHTML || '<div class="muted tiny">Noch nichts geloggt.</div>'}`;
    openSheet(html);
  }

  function chartCard(title, points, unit, now) {
    return `<div class="chart-card"><div class="ct"><span class="title">${title}</span>
      <span class="now num">${Math.round(now)} ${unit}</span></div>${Charts.line(points)}</div>`;
  }

  // ==========================================================
  //  HISTORY
  // ==========================================================
  async function renderHistory() {
    const workouts = (await DB.all('workouts'))
      .filter(w => w.status === 'completed').sort((a, b) => b.startTime - a.startTime);
    if (!workouts.length) { $('view-history').innerHTML = '<div class="empty"><div class="big">Noch kein Verlauf</div>Abgeschlossene Workouts erscheinen hier.</div>'; return; }
    // group by month
    let html = ''; let curMonth = '';
    for (const w of workouts) {
      const m = new Date(w.startTime).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
      if (m !== curMonth) { html += `<h2 class="section">${m}</h2>`; curMonth = m; }
      html += workoutRow(w);
    }
    $('view-history').innerHTML = html;
  }

  async function openWorkout(id) {
    await loadExCache();
    const w = await DB.get('workouts', id);
    const sets = await DB.byIndex('sets', 'workoutId', id);
    const byEx = {}; sets.forEach(s => (byEx[s.exerciseId] ||= []).push(s));
    let body = '';
    for (const exId of (w.exerciseOrder || Object.keys(byEx))) {
      const e = ex(exId); const arr = byEx[exId]; if (!e || !arr) continue;
      const lines = arr.map((s, i) => `<div class="row between" style="padding:4px 0">
        <span class="muted tiny">Satz ${i + 1}${s.setType !== 'working' ? ' · ' + setTypeLabel(s.setType) : ''}</span>
        <span class="num">${s.weight} kg × ${s.reps} · RIR ${s.rir}${s.prFlags && s.prFlags.length ? ' 🏆' : ''}</span></div>`).join('');
      body += `<div class="card"><div style="font-weight:700;margin-bottom:4px">${esc(e.name)}</div>${lines}</div>`;
    }
    const html = `<div class="grab"></div><h3>${esc(w.name || 'Workout')}</h3>
      <div class="muted tiny" style="margin-bottom:12px">${dateLabel(w.date)} · ${dur(w.duration || 0)} · ${w.totalSets} Sätze · ${fmtK(w.totalVolume)} kg${w.prCount ? ' · ' + w.prCount + ' PR' : ''}</div>
      ${body}
      <button class="btn ghost block" style="margin-top:8px" onclick="App.saveAsTemplate('${w.id}')">Als Vorlage speichern</button>
      <button class="btn block" style="margin-top:8px;color:var(--down)" onclick="App.deleteWorkout('${w.id}')">Workout löschen</button>`;
    openSheet(html);
  }

  async function deleteWorkout(id) {
    if (!confirm('Dieses Workout und seine Sätze löschen?')) return;
    const sets = await DB.byIndex('sets', 'workoutId', id);
    for (const s of sets) await DB.del('sets', s.id);
    await DB.del('workouts', id);
    closeSheet(); renderHistory(); toast('Gelöscht');
  }

  // ==========================================================
  //  TEMPLATES
  // ==========================================================
  async function openTemplates() {
    const tpls = await DB.all('templates');
    await loadExCache();
    let html = `<div class="grab"></div><h3>Vorlagen</h3>`;
    if (!tpls.length) html += `<div class="empty tiny">Noch keine Vorlagen. Speichere ein Workout aus dem Verlauf als Vorlage.</div>`;
    for (const t of tpls) {
      const names = t.exercises.map(e => (ex(e.exerciseId) || {}).name).filter(Boolean).slice(0, 4).join(', ');
      html += `<div class="list-item" onclick="App.runTemplate('${t.id}')">
        <div><div class="name">${esc(t.name)}</div><div class="mg">${esc(names)}${t.exercises.length > 4 ? '…' : ''}</div></div>
        <div class="pill up">Start</div></div>`;
    }
    openSheet(html);
  }
  async function runTemplate(id) { closeSheet(); S.startFromTemplate = id; await startWorkout(); }
  async function saveAsTemplate(workoutId) {
    const w = await DB.get('workouts', workoutId);
    const name = prompt('Name der Vorlage:', w.name || 'Vorlage');
    if (!name) return;
    const tpl = {
      id: DB.uid('t_'), name, createdAt: Date.now(),
      exercises: (w.exerciseOrder || []).map((exId, i) => ({ exerciseId: exId, order: i })),
    };
    await DB.put('templates', tpl); closeSheet(); toast('Vorlage gespeichert');
  }

  // ==========================================================
  //  GOALS  (light)
  // ==========================================================
  async function updateGoalsAfterWorkout() {
    const goals = await DB.all('goals');
    if (!goals.length) return;
    const done = (await DB.all('workouts')).filter(w => w.status === 'completed');
    const weekAgo = Date.now() - 7 * 86400000;
    for (const g of goals) {
      if (g.type === 'freq') g.current = done.filter(w => w.startTime >= weekAgo).length;
      else if (g.type === 'e1rm' && g.exerciseId) {
        const sets = await DB.byIndex('sets', 'exerciseId', g.exerciseId);
        const best = Logic.bestSet(sets);
        g.current = best ? Math.round(Logic.e1rm(best.weight, best.reps)) : 0;
      }
      await DB.put('goals', g);
    }
  }
  async function openNewGoal() {
    await loadExCache();
    const exOpts = Object.values(S.exCache).map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    const html = `<div class="grab"></div><h3>Neues Ziel</h3>
      <select class="text-in" id="g_type" style="margin-bottom:10px" onchange="App.goalTypeChanged(this.value)">
        <option value="freq">Workouts pro Woche</option>
        <option value="e1rm">Geschätzter 1RM (Übung)</option>
      </select>
      <div id="g_exwrap" class="hidden" style="margin-bottom:10px"><select class="text-in" id="g_ex">${exOpts}</select></div>
      <input class="text-in num" id="g_target" inputmode="numeric" placeholder="Zielwert" style="margin-bottom:12px" value="3">
      <button class="btn up block" onclick="App.saveGoal()">Ziel speichern</button>`;
    openSheet(html);
  }
  function goalTypeChanged(v) { $('g_exwrap').classList.toggle('hidden', v !== 'e1rm'); }
  async function saveGoal() {
    const type = $('g_type').value;
    const target = +$('g_target').value || 0;
    let g;
    if (type === 'freq') g = { id: DB.uid('g_'), type, label: 'Workouts / Woche', unit: '', target, current: 0 };
    else {
      const exId = $('g_ex').value; const e = ex(exId);
      g = { id: DB.uid('g_'), type, exerciseId: exId, label: e.name + ' 1RM', unit: 'kg', target, current: 0 };
    }
    await DB.put('goals', g); await updateGoalsAfterWorkout(); closeSheet(); renderHome(); toast('Ziel gespeichert');
  }
  async function editGoal(id) {
    if (confirm('Ziel löschen?')) { await DB.del('goals', id); renderHome(); }
  }

  // ==========================================================
  //  STATS
  // ==========================================================
  let statsEx = null;
  async function renderStats() {
    await loadExCache();
    const workouts = (await DB.all('workouts')).filter(w => w.status === 'completed');
    const sets = await DB.all('sets');
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    const monthAgo = now - 30 * 86400000;

    const totalVol = workouts.reduce((a, w) => a + (w.totalVolume || 0), 0);
    const weekWorkouts = workouts.filter(w => w.startTime >= weekAgo).length;
    const streak = computeStreakWeeks(workouts);

    // volume over time (per workout)
    const volSeries = workouts.sort((a, b) => a.startTime - b.startTime)
      .map(w => ({ x: w.startTime, y: w.totalVolume || 0 }));

    // sets per muscle (7 days)
    const spm = Logic.setsPerMuscle(sets, S.exCache, weekAgo);
    const barItems = DB.MUSCLE_GROUPS.filter(m => spm[m]).map(m => ({ label: DB.MG_LABEL[m].slice(0, 3), value: spm[m] }));

    // exercise picker for per-exercise charts
    const usage = {}; sets.forEach(s => usage[s.exerciseId] = (usage[s.exerciseId] || 0) + 1);
    const topEx = Object.values(S.exCache).filter(e => usage[e.id]).sort((a, b) => usage[b.id] - usage[a.id]);
    if (!statsEx && topEx.length) statsEx = topEx[0].id;

    let exCharts = '';
    if (statsEx) {
      const exSets = sets.filter(s => s.exerciseId === statsEx);
      const wmap = {}; workouts.forEach(w => wmap[w.id] = w);
      const series = Logic.exerciseSeries(exSets, wmap);
      const chips = topEx.map(e => `<button class="chip ${e.id === statsEx ? 'active' : ''}" onclick="App.setStatsEx('${e.id}')">${esc(e.name)}</button>`).join('');
      exCharts = `<h2 class="section">Übungs-Progression</h2><div class="chiprow">${chips}</div>`;
      if (series.length) {
        exCharts += chartCard('Geschätzter 1RM', series.map(r => ({ x: r.date, y: r.e1rm })), 'kg', series[series.length - 1].e1rm)
                  + chartCard('Wdh. (Top-Satz)', series.map(r => ({ x: r.date, y: r.topReps })), '', series[series.length - 1].topReps);
      } else exCharts += '<div class="muted tiny">Noch keine Daten.</div>';
    }

    $('view-stats').innerHTML = `
      <div class="metric-grid">
        <div class="metric"><div class="k">Workouts gesamt</div><div class="v num">${workouts.length}</div></div>
        <div class="metric"><div class="k">Diese Woche</div><div class="v num">${weekWorkouts}</div></div>
        <div class="metric"><div class="k">Volumen gesamt</div><div class="v num">${fmtK(totalVol)}</div><div class="d muted">kg</div></div>
        <div class="metric"><div class="k">Wochen-Streak</div><div class="v num">${streak}</div><div class="d muted">Wochen in Folge</div></div>
      </div>
      <div class="chart-card"><div class="ct"><span class="title">Volumen / Workout</span></div>${Charts.line(volSeries)}</div>
      <div class="chart-card"><div class="ct"><span class="title">Sätze pro Muskelgruppe · 7 Tage</span></div>${Charts.bars(barItems)}</div>
      ${exCharts}
      <h2 class="section">Daten</h2>
      <div class="row" style="gap:10px">
        <button class="btn ghost block" onclick="App.exportData()">Backup exportieren</button>
        <button class="btn ghost block" onclick="App.triggerImport()">Import</button>
      </div>
      <button class="btn ghost block" style="margin-top:10px" onclick="App.openNewGoal()">Ziel hinzufügen</button>
      <input type="file" id="importFile" accept="application/json" class="hidden" onchange="App.importData(this.files[0])">`;
  }
  function setStatsEx(id) { statsEx = id; renderStats(); }
  function computeStreakWeeks(workouts) {
    if (!workouts.length) return 0;
    const weeks = new Set(workouts.map(w => weekKey(w.startTime)));
    let streak = 0; let cursor = new Date();
    for (;;) {
      if (weeks.has(weekKey(cursor.getTime()))) { streak++; cursor.setDate(cursor.getDate() - 7); }
      else break;
      if (streak > 260) break;
    }
    return streak;
  }
  function weekKey(ts) {
    const d = new Date(ts); d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }

  // ---- export / import ----
  async function exportData() {
    const bundle = await DB.exportAll();
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `gym-backup-${today()}.json`; a.click();
    URL.revokeObjectURL(url); toast('Backup exportiert');
  }
  function triggerImport() { $('importFile').click(); }
  async function importData(file) {
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      if (!confirm('Import ersetzt alle aktuellen Daten. Fortfahren?')) return;
      await DB.importAll(bundle, { merge: false });
      await loadExCache(); toast('Import erfolgreich'); renderStats();
    } catch (e) { toast('Import fehlgeschlagen'); }
  }

  // ==========================================================
  //  SHEET plumbing
  // ==========================================================
  function openSheet(html) {
    $('sheet').innerHTML = html;
    $('sheet').classList.add('show'); $('scrim').classList.add('show');
  }
  function closeSheet() { $('sheet').classList.remove('show'); $('scrim').classList.remove('show'); }

  // ==========================================================
  //  INIT
  // ==========================================================
  let _booted = false;
  async function init() {
    if (_booted) return; _booted = true;
    await DB.init();
    await loadExCache();
    // wire tab bar
    document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => go(b.dataset.view));
    $('scrim').onclick = closeSheet;
    $('restSkip').onclick = skipRest;
    $('restAdd').onclick = () => addRest(15);
    // resume active workout if present
    const act = (await DB.all('workouts')).find(w => w.status === 'active');
    if (act) { go('home'); } else { go('home'); }
  }

  return {
    init, go, startWorkout, resumeWorkout, minimizeWorkout, finishWorkout,
    selectEx, openExercisePicker, filterPicker, pickExercise, openNewExercise, saveNewExercise,
    step, setEntry, setType, saveSet, deleteSet, repeatLast,
    setExFilter, openExercise, openWorkout, deleteWorkout,
    openTemplates, runTemplate, saveAsTemplate,
    openNewGoal, goalTypeChanged, saveGoal, editGoal,
    renderStats, setStatsEx, exportData, triggerImport, importData,
    // rest strip
  };
})();

window.DB = DB; window.Logic = Logic; window.Charts = Charts; window.App = App;
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', App.init);
else App.init();
