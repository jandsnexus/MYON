/* ============================================================
   Gym Tracker — single-file build (db + logic + charts + app)
   Vanilla JS, zero deps, offline-first (IndexedDB).
   ============================================================ */

/* ---- DB: IndexedDB layer ---- */
const DB = (() => {
  const NAME = 'gymtracker';
  const VERSION = 2;
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
        if (!db.objectStoreNames.contains('bodyweight')) {
          const s = db.createObjectStore('bodyweight', { keyPath: 'id' });
          s.createIndex('date', 'date', { unique: false });
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
    for (const s of ['exercises', 'workouts', 'sets', 'templates', 'goals', 'bodyweight', 'meta']) {
      data[s] = await all(s);
    }
    return { app: 'gymtracker', version: VERSION, exportedAt: Date.now(), data };
  }
  async function importAll(bundle, { merge = false } = {}) {
    const d = bundle.data || {};
    for (const s of ['exercises', 'workouts', 'sets', 'templates', 'goals', 'bodyweight', 'meta']) {
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

  // ---- Weekly volume landmarks (working sets / muscle / week) ------
  // Rough hypertrophy guideposts (Israetel-style ranges). Not gospel —
  // used to colour the balance bars: below MEV / in range / above MRV.
  const LANDMARKS = {
    chest:     { mev: 10, mav: [12, 20], mrv: 22 },
    back:      { mev: 10, mav: [14, 22], mrv: 25 },
    shoulders: { mev: 8,  mav: [16, 22], mrv: 26 },
    legs:      { mev: 8,  mav: [12, 18], mrv: 20 },
    biceps:    { mev: 8,  mav: [14, 20], mrv: 26 },
    triceps:   { mev: 6,  mav: [10, 16], mrv: 18 },
    core:      { mev: 0,  mav: [8, 16],  mrv: 20 },
  };
  function landmarkState(mg, sets) {
    const L = LANDMARKS[mg]; if (!L) return 'ok';
    if (sets < L.mev) return 'low';        // under maintenance
    if (sets > L.mrv) return 'high';       // junk-volume territory
    if (sets >= L.mav[0] && sets <= L.mav[1]) return 'opt'; // sweet spot
    return 'ok';
  }

  // ---- Progressive-overload suggestion (pre-fill, never forced) ----
  // Look at the best working set of the LAST session and, factoring RIR
  // + the target rep range, propose the next set. User just confirms.
  function overloadSuggestion(exercise, lastSessionSets) {
    const range = exercise.defaultRepRange || { min: 8, max: 12 };
    const working = (lastSessionSets || []).filter(isWorking);
    if (!working.length) return null;
    const top = working.reduce((b, s) => e1rm(s.weight, s.reps) > e1rm(b.weight, b.reps) ? s : b);
    const inc = exercise.category === 'compound' ? 2.5 : 1.25;
    let w = top.weight, r = top.reps, why;
    if (r >= range.max && (top.rir ?? 2) <= 1) {
      w = Math.round((top.weight + inc) * 2) / 2; r = range.min;
      why = `Letztes Mal ${top.weight} kg × ${top.reps} bei RIR ${top.rir ?? '?'} — reif für ${w} kg.`;
    } else if (r >= range.max) {
      r = Math.min(range.max, top.reps + 1);
      why = `Noch ${top.rir ?? '?'} im Tank — halte ${top.weight} kg, geh auf ${r} Wdh.`;
    } else {
      r = Math.min(range.max, top.reps + 1);
      why = `Bau auf ${top.weight} kg auf: Ziel ${r} Wdh. Richtung oberes Ende (${range.max}).`;
    }
    return { weight: w, reps: r, rir: 2, text: why };
  }

  // ---- Recent PRs across everything (for the dashboard) ------------
  function recentPRs(sets, exerciseMap, limit = 5) {
    return sets.filter(s => s.prFlags && s.prFlags.length)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map(s => ({
        name: exerciseMap[s.exerciseId] ? exerciseMap[s.exerciseId].name : 'Übung',
        weight: s.weight, reps: s.reps, when: s.timestamp,
        kind: PR_LABEL[s.prFlags[0]], flags: s.prFlags,
      }));
  }

  return {
    e1rm, volume, isWorking, detectPRs, PR_LABEL,
    progressionHint, summarizeWorkout, bestSet,
    exerciseSeries, setsPerMuscle,
    LANDMARKS, landmarkState, overloadSuggestion, recentPRs,
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

  // ---- Reactor ring (rest timer) ----------------------------------
  function ring(remaining, total, warn) {
    const R = 46, C = 2 * Math.PI * R;
    const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
    const off = C * (1 - pct);
    const m = Math.floor(Math.max(0, remaining) / 60), s = Math.max(0, remaining) % 60;
    const label = `${m}:${String(s).padStart(2, '0')}`;
    return `<svg class="ring ${warn ? 'warn' : ''}" viewBox="0 0 120 120">
      <circle class="ring-track" cx="60" cy="60" r="${R}"/>
      <circle class="ring-glow" cx="60" cy="60" r="${R}"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 60 60)"/>
      <circle class="ring-prog" cx="60" cy="60" r="${R}"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        transform="rotate(-90 60 60)"/>
      <text class="ring-label" x="60" y="66" text-anchor="middle">${label}</text>
    </svg>`;
  }

  // ---- Contribution-style training heatmap ------------------------
  // map: { 'YYYY-MM-DD': volume }. Draws `weeks` columns × 7 rows.
  function heatCalendar(map, weeks = 12) {
    const cell = 15, gap = 4, rows = 7;
    const w = weeks * (cell + gap), h = rows * (cell + gap) + 4;
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    // find max for bucketing
    const vals = Object.values(map).filter(v => v > 0);
    const max = vals.length ? Math.max(...vals) : 1;
    const level = (v) => !v ? 0 : v >= max * 0.75 ? 4 : v >= max * 0.5 ? 3 : v >= max * 0.25 ? 2 : 1;
    // start on Monday of the earliest visible week
    const start = new Date(today0);
    const dow = (start.getDay() + 6) % 7;          // 0 = Monday
    start.setDate(start.getDate() - dow - (weeks - 1) * 7);
    let cells = '';
    for (let c = 0; c < weeks; c++) {
      for (let r = 0; r < rows; r++) {
        const d = new Date(start); d.setDate(start.getDate() + c * 7 + r);
        if (d > today0) continue;
        const key = d.toISOString().slice(0, 10);
        const lv = level(map[key] || 0);
        const x = c * (cell + gap), y = r * (cell + gap);
        cells += `<rect class="heat l${lv}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3"><title>${key}</title></rect>`;
      }
    }
    return `<svg class="heatcal" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMid meet">${cells}</svg>`;
  }

  // ---- Body heatmap (front + back silhouette) ---------------------
  // volumes: { mg: workingSetsThisWeek }, mrv: { mg: number }
  function bodyHeat(volumes, mrv) {
    const intensity = (mg) => {
      const v = volumes[mg] || 0, m = (mrv && mrv[mg]) || 20;
      return Math.max(0, Math.min(1, v / m));
    };
    const spot = (cx, cy, r, mg) => {
      const o = intensity(mg);
      const fill = o <= 0 ? 0.05 : 0.15 + o * 0.85;
      return `<circle class="bh" cx="${cx}" cy="${cy}" r="${r}" style="opacity:${fill.toFixed(2)}"><title>${mg}: ${volumes[mg] || 0} Sätze</title></circle>`;
    };
    // faint silhouette (front @x~60, back @x~180)
    const fig = (ox) => `
      <g class="sil" transform="translate(${ox},0)">
        <circle cx="0" cy="16" r="9"/>
        <path d="M-15 30 Q0 26 15 30 L20 40 L15 78 L8 78 L6 120 L-6 120 L-8 78 L-15 78 L-20 40 Z"/>
        <path d="M-18 34 L-27 74 M18 34 L27 74"/>
        <path d="M-6 120 L-8 165 M6 120 L8 165"/>
      </g>`;
    return `<svg class="bodyheat" viewBox="0 0 240 190" preserveAspectRatio="xMidYMid meet">
      ${fig(60)}${fig(180)}
      <!-- FRONT -->
      ${spot(46, 42, 8, 'shoulders')}${spot(74, 42, 8, 'shoulders')}
      ${spot(52, 54, 9, 'chest')}${spot(68, 54, 9, 'chest')}
      ${spot(37, 60, 6, 'biceps')}${spot(83, 60, 6, 'biceps')}
      ${spot(60, 74, 8, 'core')}
      ${spot(53, 108, 8, 'legs')}${spot(67, 108, 8, 'legs')}
      <!-- BACK -->
      ${spot(172, 52, 10, 'back')}${spot(188, 52, 10, 'back')}
      ${spot(157, 60, 6, 'triceps')}${spot(203, 60, 6, 'triceps')}
      ${spot(173, 108, 8, 'legs')}${spot(187, 108, 8, 'legs')}
      <text class="bh-cap" x="60" y="185" text-anchor="middle">VORNE</text>
      <text class="bh-cap" x="180" y="185" text-anchor="middle">HINTEN</text>
    </svg>`;
  }

  return { line, bars, ring, heatCalendar, bodyHeat };
})();

/* ---- ANATOMY: interactive muscle map (front/back SVG) ---- */
const Anatomy = (() => {
  // region -> { label, group (coarse data group), f (intensity factor) }
  const REGION = {
    chest:      { label: 'Brust', group: 'chest' },
    front_delt: { label: 'Vordere Schulter', group: 'shoulders' },
    side_delt:  { label: 'Seitliche Schulter', group: 'shoulders' },
    rear_delt:  { label: 'Hintere Schulter', group: 'shoulders' },
    biceps:     { label: 'Bizeps', group: 'biceps' },
    triceps:    { label: 'Trizeps', group: 'triceps' },
    forearm:    { label: 'Unterarme', group: 'biceps', f: 0.5 },
    abs:        { label: 'Bauch', group: 'core' },
    quad:       { label: 'Quadrizeps', group: 'legs' },
    hamstring:  { label: 'Beinbeuger', group: 'legs' },
    glute:      { label: 'Glutes', group: 'legs' },
    calf:       { label: 'Waden', group: 'legs' },
    lat:        { label: 'Latissimus', group: 'back' },
    trap:       { label: 'Trapez', group: 'back' },
    lower_back: { label: 'Unterer Rücken', group: 'back' },
  };

  // base body silhouette (shared front/back) — soft overlapping shapes
  const BODY = `
    <circle cx="100" cy="30" r="19"/>
    <path d="M90 47 h20 v10 h-20 Z"/>
    <path d="M72 84 C72 80 128 80 128 84 C137 112 131 142 126 154 C124 182 132 198 130 214 C130 222 70 222 70 214 C68 198 76 182 74 154 C69 142 63 112 72 84 Z"/>
    <path d="M60 86 C50 88 46 96 46 110 C46 140 46 170 48 190 C49 198 59 198 60 190 C62 170 63 140 63 112 C63 98 66 88 60 86 Z"/>
    <path d="M140 86 C150 88 154 96 154 110 C154 140 154 170 152 190 C151 198 141 198 140 190 C138 170 137 140 137 112 C137 98 134 88 140 86 Z"/>
    <path d="M96 216 C86 214 80 224 80 244 C80 304 80 362 84 402 C85 412 95 412 96 402 C99 362 99 304 98 248 C98 228 100 218 96 216 Z"/>
    <path d="M104 216 C114 214 120 224 120 244 C120 304 120 362 116 402 C115 412 105 412 104 402 C101 362 101 304 102 248 C102 228 100 218 104 216 Z"/>`;

  // paired muscles are authored on the LEFT (x<100) and mirrored to the right.
  const FRONT_PAIRED = {
    front_delt: 'M62 84 C54 84 50 92 52 100 C60 102 68 98 68 90 C68 86 66 84 62 84 Z',
    side_delt:  'M52 92 C45 94 43 106 48 116 C55 116 59 106 57 98 C56 94 55 92 52 92 Z',
    chest:      'M97 100 C85 97 73 99 66 107 C63 114 69 124 80 126 C90 128 97 122 97 114 Z',
    biceps:     'M50 118 C44 122 44 140 49 156 C56 157 60 148 58 133 C57 125 54 120 50 118 Z',
    forearm:    'M49 158 C44 162 44 180 49 194 C55 195 58 186 56 171 C55 163 52 160 49 158 Z',
    quad:       'M97 226 C84 224 75 240 77 268 C79 292 88 301 96 299 C98 279 98 250 97 232 C97 228 97 226 97 226 Z',
    calf:       'M94 320 C87 320 82 334 84 356 C86 372 92 374 95 370 C97 354 97 334 96 324 C96 321 95 320 94 320 Z',
  };
  const FRONT_CENTRAL = {
    abs: 'M89 133 h9 v15 h-9 Z M102 133 h9 v15 h-9 Z M89 151 h9 v15 h-9 Z M102 151 h9 v15 h-9 Z M89 169 h9 v15 h-9 Z M102 169 h9 v15 h-9 Z M91 187 C91 200 109 200 109 187 L108 187 C108 198 92 198 92 187 Z',
  };
  const BACK_PAIRED = {
    rear_delt: 'M60 86 C52 86 48 94 51 102 C59 104 67 100 66 92 C66 88 64 86 60 86 Z',
    lat:       'M96 124 L75 121 C69 133 68 151 75 167 C81 180 89 188 95 188 C96 170 97 148 96 124 Z',
    triceps:   'M50 118 C44 122 44 140 49 156 C56 157 60 148 58 133 C57 125 54 120 50 118 Z',
    forearm:   'M49 158 C44 162 44 180 49 194 C55 195 58 186 56 171 C55 163 52 160 49 158 Z',
    glute:     'M97 216 C87 214 79 224 80 238 C81 250 91 254 98 250 C100 240 100 226 98 218 Z',
    hamstring: 'M96 254 C88 252 81 264 82 288 C83 308 89 316 96 314 C98 296 98 272 97 258 Z',
    calf:      'M94 320 C87 320 82 334 84 356 C86 372 92 374 95 370 C97 354 97 334 96 324 C96 321 95 320 94 320 Z',
  };
  const BACK_CENTRAL = {
    trap:       'M100 76 C88 78 80 86 78 98 C86 105 95 107 100 107 C105 107 114 105 122 98 C120 86 112 78 100 76 Z',
    lower_back: 'M91 188 C91 184 109 184 109 188 L108 210 C108 216 92 216 92 210 Z',
  };

  function intensity(region, spm) {
    const m = REGION[region]; if (!m) return 0;
    const L = (typeof Logic !== 'undefined') && Logic.LANDMARKS[m.group];
    const mrv = L ? L.mrv : 20;
    const v = (spm[m.group] || 0) * (m.f || 1);
    return Math.max(0, Math.min(1, v / mrv));
  }
  const tier = (i) => i <= 0 ? 0 : i < .25 ? 1 : i < .5 ? 2 : i < .75 ? 3 : 4;

  function musclePath(region, d, spm, mirror) {
    const i = intensity(region, spm);
    const op = i <= 0 ? 0 : (0.18 + i * 0.72);
    const t = tier(i);
    const tr = mirror ? ' transform="matrix(-1 0 0 1 200 0)"' : '';
    return `<path class="m t${t}" data-m="${region}"${tr} d="${d}" fill="var(--up)" fill-opacity="${op.toFixed(2)}" onclick="App.muscleTap('${region}')"/>`;
  }

  function svg(view, spm) {
    spm = spm || {};
    const paired = view === 'back' ? BACK_PAIRED : FRONT_PAIRED;
    const central = view === 'back' ? BACK_CENTRAL : FRONT_CENTRAL;
    let m = '';
    for (const id in paired) { m += musclePath(id, paired[id], spm, false); m += musclePath(id, paired[id], spm, true); }
    for (const id in central) m += musclePath(id, central[id], spm, false);
    return `<svg class="anat-svg" viewBox="0 0 200 430" preserveAspectRatio="xMidYMid meet" role="img">
      <g class="anat-body">${BODY}</g>
      <g class="anat-m">${m}</g>
    </svg>`;
  }

  return { REGION, svg, intensity };
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
    suggestByEx: {},       // exId -> overload suggestion
    lastByEx: {},          // exId -> { sets:[...], ts } from last session
    bodyView: 'front',
    anatSpm: {},
    settings: { name: 'Sam', haptics: true, sound: false },
  };

  // ---------- helpers ----------
  const vibrate = (ms) => { try { if (S.settings && !S.settings.haptics) return; navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };
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
    else if (view === 'training') renderTraining();
    else if (view === 'exercises') renderExercises();
    else if (view === 'progress') renderProgress();
    else if (view === 'profile') renderProfile();
  }

  // ==========================================================
  //  HOME
  // ==========================================================
  async function renderHome() {
    const name = await DB.metaGet('name', 'Sam');
    const workouts = (await DB.all('workouts'));
    const done = workouts.filter(w => w.status === 'completed').sort((a, b) => b.startTime - a.startTime);
    const sets = await DB.all('sets');
    const now = Date.now(), weekAgo = now - 7 * 86400000;
    const thisWeek = done.filter(w => w.startTime >= weekAgo);
    const active = workouts.find(w => w.status === 'active');

    const h = new Date().getHours();
    const greet = h < 5 ? 'Late night' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Servus' : h < 22 ? 'Guten Abend' : 'Late night';
    const streak = computeStreakWeeks(done);
    const trainedToday = done.some(w => w.date === today());
    const weekSets = thisWeek.reduce((a, w) => a + (w.totalSets || 0), 0);

    // ---------- HERO ----------
    let html = `
      <div class="hero">
        <div class="hero-grid"></div>
        <button class="hero-gear" onclick="App.openSettings()" aria-label="Einstellungen">⚙</button>
        <div class="hero-top">
          <div class="reactor ${trainedToday ? 'on' : ''}"><span></span></div>
          <div>
            <div class="hero-hi">${greet}, <b>${esc(name)}</b></div>
            <div class="hero-sub">${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          </div>
        </div>
        <div class="hero-stats">
          <div><div class="hs-v num" data-count="${thisWeek.length}">0</div><div class="hs-k">Einheiten / Woche</div></div>
          <div><div class="hs-v num" data-count="${weekSets}">0</div><div class="hs-k">Sätze / Woche</div></div>
          <div><div class="hs-v num" data-count="${streak}">0</div><div class="hs-k">Streak ${streak > 0 ? '🔥' : ''}</div></div>
        </div>
        <div class="consistency">${consistencyDots(done)}</div>
      </div>`;

    // ---------- PRIMARY ACTION ----------
    html += active
      ? `<button class="btn up block lg" onclick="App.resumeWorkout()" style="margin:4px 0 8px">▶ Laufendes Training fortsetzen</button>`
      : `<button class="btn up block lg" onclick="App.go('training')" style="margin:4px 0 8px">Training starten</button>`;
    html += `<div class="quickrow">
        <button class="quick" onclick="App.openTemplates()"><span class="qi">▤</span>Vorlage</button>
        <button class="quick" onclick="App.openPlateCalc()"><span class="qi">◔</span>Scheiben</button>
        <button class="quick" onclick="App.openBodyweight()"><span class="qi">⚖</span>Gewicht</button>
        <button class="quick" onclick="App.go('progress')"><span class="qi">≣</span>Progress</button>
      </div>`;

    // ---------- MUSCLE HEATMAP (interactive, hero visual) ----------
    const spmHome = Logic.setsPerMuscle(sets, S.exCache, weekAgo);
    html += muscleMapHTML(spmHome);

    // ---------- HEUTE & ZULETZT ----------
    const last = done[0];
    let lastHtml;
    if (last) {
      const lastSets = sets.filter(s => s.workoutId === last.id);
      const grps = [...new Set(lastSets.map(s => (S.exCache[s.exerciseId] || {}).muscleGroup).filter(Boolean))]
        .map(m => DB.MG_LABEL[m]).join(' · ') || '—';
      lastHtml = `<div class="tl-last" onclick="App.openWorkout('${last.id}')">
        <div class="row between"><div style="font-weight:700">${esc(last.name || 'Workout')}</div><div class="muted tiny">${dateLabel(last.date)}</div></div>
        <div class="muted tiny" style="margin:4px 0 8px">${grps}</div>
        <div class="row" style="gap:16px">
          <span class="tiny"><b class="num">${last.totalSets || 0}</b> Sätze</span>
          <span class="tiny"><b class="num">${fmtK(last.totalVolume || 0)}</b> kg</span>
          <span class="tiny"><b class="num">${dur(last.duration || 0)}</b></span>
          ${last.prCount ? `<span class="pill pr">${last.prCount} PR</span>` : ''}
        </div></div>`;
    } else {
      lastHtml = `<div class="muted tiny">Noch kein abgeschlossenes Training.</div>`;
    }
    const under = DB.MUSCLE_GROUPS.filter(m => Logic.landmarkState(m, (Logic.setsPerMuscle(sets, S.exCache, weekAgo)[m] || 0)) === 'low');
    let nextHint = '';
    if (done.length) nextHint = under.length
      ? `Nächster Fokus: <b>${under.slice(0, 3).map(m => DB.MG_LABEL[m]).join(', ')}</b> — diese Woche zu kurz gekommen.`
      : `Volumen diese Woche gut verteilt. Weiter so.`;
    html += `<div class="card"><div class="card-h"><span>Heute &amp; zuletzt</span></div>
      <div class="tl-today">${trainedToday ? '✓ Heute trainiert' : (active ? '● Training läuft' : '○ Heute noch offen')}</div>
      ${lastHtml}
      ${nextHint ? `<div class="tl-next">↳ ${nextHint}</div>` : ''}</div>`;

    // ---------- CURRENT PRs (kurz) ----------
    const prs = Logic.recentPRs(sets, S.exCache, 3);
    if (prs.length) {
      html += `<div class="row between" style="margin:22px 4px 10px"><h2 class="section" style="margin:0">Aktuelle Rekorde</h2><button class="link-more" onclick="App.go('progress')">alle ›</button></div>`;
      for (const p of prs) html += `<div class="pr-row">
        <div class="pr-badge">🏆</div>
        <div class="stack"><div style="font-weight:700">${esc(p.name)}</div><div class="muted tiny">${esc(p.kind)} · ${dateLabel(new Date(p.when).toISOString().slice(0,10))}</div></div>
        <div class="num pr-val">${p.weight}×${p.reps}</div></div>`;
    }

    // ---------- RECENT WORKOUTS (kurz) ----------
    html += `<div class="row between" style="margin:22px 4px 10px"><h2 class="section" style="margin:0">Letzte Einheiten</h2>${done.length > 3 ? `<button class="link-more" onclick="App.go('progress')">Verlauf ›</button>` : ''}</div>`;
    if (!done.length) {
      html += `<div class="empty"><div class="big">Bereit für Einheit #1</div>${Object.keys(S.exCache).length} Übungen liegen bereit. Starte oben — alles bleibt lokal auf dem Gerät.</div>`;
    } else {
      for (const w of done.slice(0, 3)) html += workoutRow(w);
    }

    $('view-home').innerHTML = html;
    runCountUps();
  }

  // 7-day consistency dots (trained / rest)
  function consistencyDots(done) {
    const set = new Set(done.map(w => w.date));
    const days = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];
    const mon = new Date(); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    let out = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon); d.setDate(mon.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const isToday = key === today();
      const on = set.has(key);
      out += `<div class="cd ${on ? 'on' : ''} ${isToday ? 'today' : ''}"><span></span><i>${days[i]}</i></div>`;
    }
    return out;
  }

  // ---- interactive anatomical muscle map (Home + Progress) ----
  function muscleMapHTML(spm) {
    S.anatSpm = spm || {};
    const empty = !Object.values(S.anatSpm).some(v => v > 0);
    return `<div class="card anat-card"><div class="card-h"><span>Muskel-Heatmap · 7 Tage</span>
        <div class="fb-switch">
          <button class="fb ${S.bodyView === 'front' ? 'active' : ''}" onclick="App.setBodyView('front')">Front</button>
          <button class="fb ${S.bodyView === 'back' ? 'active' : ''}" onclick="App.setBodyView('back')">Back</button>
        </div></div>
      <div class="anat-wrap" id="anatSvgWrap">${Anatomy.svg(S.bodyView, S.anatSpm)}</div>
      <div class="anat-cap muted tiny">${empty ? 'Noch keine Trainingsdaten — trainiere, um deine Heatmap zu füllen.' : 'Tippe einen Muskel für Details. Farbe = Volumen der letzten 7 Tage.'}</div></div>`;
  }
  function setBodyView(v) {
    if (S.bodyView === v) return;
    S.bodyView = v; vibrate(6);
    document.querySelectorAll('.fb-switch .fb').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase() === (v === 'front' ? 'front' : 'back')));
    const wrap = $('anatSvgWrap'); if (!wrap) return;
    wrap.classList.add('swap');
    setTimeout(() => { wrap.innerHTML = Anatomy.svg(v, S.anatSpm); wrap.classList.remove('swap'); }, 130);
  }
  async function muscleTap(region) {
    const meta = Anatomy.REGION[region]; if (!meta) return;
    vibrate(8);
    await loadExCache();
    const group = meta.group;
    const gsets = (await DB.all('sets')).filter(s => Logic.isWorking(s) && (S.exCache[s.exerciseId] || {}).muscleGroup === group);
    // highlight tapped muscle
    document.querySelectorAll('.anat-m .m').forEach(p => p.classList.toggle('sel', p.getAttribute('data-m') === region));
    if (!gsets.length) {
      openSheet(`<div class="grab"></div><div class="ms-head"><h3>${meta.label}</h3><span class="ms-grp">${DB.MG_LABEL[group] || ''}</span></div>
        <div class="empty" style="padding:26px 10px">Noch keine Daten für ${DB.MG_LABEL[group] || meta.label}.
        <div style="margin-top:14px"><button class="btn up" onclick="App.closeSheetGo('training')">Training starten</button></div></div>`);
      return;
    }
    const now = Date.now();
    const s7 = gsets.filter(s => s.timestamp >= now - 7 * 86400000).length;
    const last = Math.max(...gsets.map(s => s.timestamp));
    const cur = gsets.filter(s => s.timestamp >= now - 14 * 86400000).length;
    const prev = gsets.filter(s => s.timestamp >= now - 28 * 86400000 && s.timestamp < now - 14 * 86400000).length;
    const trend = cur > prev ? '↑' : cur < prev ? '↓' : '→';
    const L = Logic.LANDMARKS[group];
    openSheet(`<div class="grab"></div><div class="ms-head"><h3>${meta.label}</h3><span class="ms-grp">${DB.MG_LABEL[group] || ''}</span></div>
      <div class="ms-stats">
        <div><div class="ms-v num">${s7}</div><div class="ms-k">Sätze · 7 T</div></div>
        <div><div class="ms-v num">${gsets.length}</div><div class="ms-k">Sätze gesamt</div></div>
        <div><div class="ms-v num tr-${trend === '↑' ? 'up' : trend === '↓' ? 'down' : 'flat'}">${trend}</div><div class="ms-k">Trend 2 Wo.</div></div>
      </div>
      <div class="ms-row">Zuletzt trainiert <b>${dateLabel(new Date(last).toISOString().slice(0, 10))}</b></div>
      ${L ? `<div class="ms-row">Produktives Volumen <b>${L.mav[0]}–${L.mav[1]} Sätze/Woche</b></div>` : ''}`);
  }
  function closeSheetGo(v) { closeSheet(); go(v); }

  // sets-per-muscle balance bars vs MEV/MAV/MRV landmarks
  function landmarkBars(spm) {
    let out = '<div class="lm">';
    for (const mg of DB.MUSCLE_GROUPS) {
      const L = Logic.LANDMARKS[mg]; if (!L) continue;
      const v = spm[mg] || 0;
      const state = Logic.landmarkState(mg, v);
      const pct = Math.min(100, (v / L.mrv) * 100);
      const mavLo = (L.mav[0] / L.mrv) * 100, mavHi = (L.mav[1] / L.mrv) * 100;
      out += `<div class="lm-row">
        <div class="lm-lbl">${DB.MG_LABEL[mg]}</div>
        <div class="lm-track">
          <div class="lm-zone" style="left:${mavLo}%;width:${mavHi - mavLo}%"></div>
          <div class="lm-fill ${state}" style="width:${pct}%"></div>
        </div>
        <div class="lm-num num ${state}">${v}</div></div>`;
    }
    out += `</div><div class="lm-cap muted tiny">Grünes Feld = produktiver Bereich (MAV). Amber = unter MEV, Rot = über MRV.</div>`;
    return out;
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
    go('training');
    if (!S.order.length) openExercisePicker();
  }
  async function repeatLastWorkout() {
    await loadExCache();
    const done = (await DB.all('workouts')).filter(w => w.status === 'completed').sort((a, b) => b.startTime - a.startTime);
    const last = done[0]; if (!last) return startWorkout();
    const order = last.exerciseOrder && last.exerciseOrder.length
      ? last.exerciseOrder
      : [...new Set((await DB.byIndex('sets', 'workoutId', last.id)).map(s => s.exerciseId))];
    await startWorkout();
    for (const id of order) if (S.exCache[id]) await addExercise(id, false);
    closeSheet();
    S.curEx = S.order[0] || null;
    if (S.curEx) { await prefillFromLast(S.curEx); await computeSuggestion(S.curEx); }
    if (S.view === 'training') { refreshExSwitch(); refreshLiveBody(); }
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
    go('training');
    if (!S.order.length) openExercisePicker();
  }

  // Training tab: live workout if one is active, else a fast start screen
  async function renderTraining() {
    if (S.active) { renderLive(); return; }
    await loadExCache();
    const done = (await DB.all('workouts')).filter(w => w.status === 'completed').sort((a, b) => b.startTime - a.startTime);
    const last = done[0];
    const templates = await DB.all('templates');
    let html = `<div class="train-start">
      <div class="ts-icon"><div class="reactor on"><span></span></div></div>
      <h1 class="ts-h">Bereit?</h1>
      <p class="ts-sub">Leeres Training starten oder direkt weitermachen.</p>
      <button class="btn up block lg" onclick="App.startWorkout()">Neues Training starten</button>`;
    if (last) {
      const lastSets = (await DB.byIndex('sets', 'workoutId', last.id));
      const grps = [...new Set(lastSets.map(s => (S.exCache[s.exerciseId] || {}).muscleGroup).filter(Boolean))].map(m => DB.MG_LABEL[m]).join(' · ');
      html += `<button class="btn ghost block" style="margin-top:10px" onclick="App.repeatLastWorkout()">↺ Letztes wiederholen · ${esc(last.name || 'Workout')}</button>
        <div class="muted tiny" style="text-align:center;margin-top:6px">${grps || ''}</div>`;
    }
    if (templates.length) {
      html += `<h2 class="section" style="text-align:center">Vorlagen</h2><div class="ts-tpls">`;
      for (const t of templates.slice(0, 6)) html += `<button class="ts-tpl" onclick="App.runTemplate('${t.id}')">${esc(t.name)}<span class="muted tiny">${(t.exercises || []).length} Übungen</span></button>`;
      html += `</div>`;
    }
    html += `</div>`;
    $('view-training').innerHTML = html;
  }

  function renderLive() {
    if (!S.active) { renderTraining(); return; }
    const elapsed = Date.now() - S.active.startTime;
    let html = `
      <div class="live-head">
        <button class="btn ghost" style="min-height:40px;padding:0 14px" onclick="App.minimizeWorkout()">‹ Pause</button>
        <div class="live-timer">Dauer <span class="num" id="liveDur">${dur(elapsed)}</span></div>
        <button class="btn up" style="min-height:40px;padding:0 16px" onclick="App.finishWorkout()">Beenden</button>
      </div>
      <div class="ex-switch" id="exSwitch">${exSwitchHTML()}</div>
      <div class="live-body" id="liveBody">${liveBodyHTML()}</div>`;
    $('view-training').innerHTML = html;
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
    const sug = S.suggestByEx[S.curEx];
    const lastData = S.lastByEx[S.curEx];
    let lastHTML = '';
    if (lastData && lastData.sets.length) {
      const when = dateLabel(new Date(lastData.ts).toISOString().slice(0, 10));
      const chips = lastData.sets.map(s => `<span class="lt-set num">${s.weight}×${s.reps}<i>RIR ${s.rir}</i></span>`).join('');
      lastHTML = `<div class="lasttime">
        <div class="lt-h">LETZTES MAL · ${when}</div>
        <div class="lt-sets">${chips}</div></div>`;
    }
    const sugHTML = sug ? `<div class="hint sug">
      <svg class="ic" viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>
      <div class="txt"><b>Vorschlag: ${sug.weight} kg × ${sug.reps}</b> — ${esc(sug.text)}
      <button class="mini" onclick="App.applySuggestion()">Übernehmen</button></div></div>` : '';

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
      ${lastHTML}
      ${sugHTML}
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

  async function selectEx(id) {
    S.curEx = id; await prefillFromLast(id); await computeSuggestion(id);
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
      showPR(prFlags, set, (ex(S.curEx) || {}).name || 'Übung');
    } else { vibrate(12); beep(620); }

    // auto rest timer + auto-advance to next set (same values pre-filled)
    startRest(en.setType === 'warmup' ? 45 : 120);

    refreshExSwitch(); refreshLiveBody();
    const rows = document.querySelectorAll('#liveBody .set-line');
    const lastRow = rows[rows.length - 1];
    if (lastRow) { lastRow.classList.add('justsaved'); }
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

  // ---- rest timer (reactor ring) ----
  function startRest(sec) {
    S.rest.total = sec; S.rest.t = sec;
    const strip = $('restStrip'); strip.classList.add('show');
    strip.innerHTML = `
      <div class="rest-ring-wrap">${Charts.ring(sec, sec, false)}</div>
      <div class="rest-ctrls">
        <div class="rest-cap">PAUSE</div>
        <div class="row" style="gap:8px">
          <button class="btn ghost rest-btn" onclick="App.addRest(15)">+15s</button>
          <button class="btn ghost rest-btn" onclick="App.addRest(30)">+30s</button>
          <button class="btn up rest-btn" onclick="App.skipRest()">Skip</button>
        </div>
      </div>`;
    if (S.rest.iv) clearInterval(S.rest.iv);
    S.rest.iv = setInterval(() => {
      S.rest.t--;
      if (S.rest.t <= 0) { finishRest(); return; }
      updateRing();
    }, 1000);
  }
  function updateRing() {
    const strip = $('restStrip');
    const svg = strip.querySelector('svg.ring'); if (!svg) return;
    const R = 46, C = 2 * Math.PI * R;
    const pct = S.rest.total > 0 ? Math.max(0, Math.min(1, S.rest.t / S.rest.total)) : 0;
    const off = (C * (1 - pct)).toFixed(1);
    svg.querySelectorAll('.ring-prog, .ring-glow').forEach(c => c.setAttribute('stroke-dashoffset', off));
    const lbl = svg.querySelector('.ring-label'); if (lbl) lbl.textContent = clock(S.rest.t);
    svg.classList.toggle('warn', S.rest.t <= 10);
  }
  function addRest(d) {
    S.rest.t = Math.max(1, S.rest.t + d);
    S.rest.total = Math.max(S.rest.total, S.rest.t);
    updateRing();
  }
  function finishRest() {
    if (S.rest.iv) clearInterval(S.rest.iv);
    S.rest.iv = null;
    vibrate([30, 60, 30]); beep(880);
    const strip = $('restStrip');
    const svg = strip.querySelector('svg.ring');
    if (svg) { svg.classList.remove('warn'); svg.classList.add('done'); const l = svg.querySelector('.ring-label'); if (l) l.textContent = 'LOS'; }
    setTimeout(() => strip.classList.remove('show'), 1300);
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
    if (select || !S.curEx) { S.curEx = id; await prefillFromLast(id); await computeSuggestion(id); }
    if (S.active) { S.active.exerciseOrder = S.order; await DB.put('workouts', S.active); }
    if (S.view === 'training') { refreshExSwitch(); refreshLiveBody(); }
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
    if (S.view === 'training') { await addExercise(e.id, true); }
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
    closeSheet(); if (S.view==='progress') renderProgress(); toast('Gelöscht');
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
  //  PROGRESS (charts + history)
  // ==========================================================
  let statsEx = null;
  async function renderProgress() {
    await loadExCache();
    const workouts = (await DB.all('workouts')).filter(w => w.status === 'completed');
    const sets = await DB.all('sets');
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;

    const totalVol = workouts.reduce((a, w) => a + (w.totalVolume || 0), 0);
    const weekWorkouts = workouts.filter(w => w.startTime >= weekAgo).length;
    const streak = computeStreakWeeks(workouts);
    const done = [...workouts].sort((a, b) => b.startTime - a.startTime);

    const weekly = computeWeekly(done, 8);
    const volSeries = [...workouts].sort((a, b) => a.startTime - b.startTime).map(w => ({ x: w.startTime, y: w.totalVolume || 0 }));
    const weekVol = workouts.filter(w => w.startTime >= weekAgo).reduce((a, w) => a + (w.totalVolume || 0), 0);
    const spm = Logic.setsPerMuscle(sets, S.exCache, weekAgo);
    const mrv = {}; for (const m in Logic.LANDMARKS) mrv[m] = Logic.LANDMARKS[m].mrv;
    const bw = (await DB.all('bodyweight')).sort((a, b) => a.ts - b.ts);
    const goals = await DB.all('goals');
    const dayVol = {}; for (const w of done) dayVol[w.date] = (dayVol[w.date] || 0) + (w.totalVolume || 0);

    const usage = {}; sets.forEach(s => usage[s.exerciseId] = (usage[s.exerciseId] || 0) + 1);
    const topEx = Object.values(S.exCache).filter(e => usage[e.id]).sort((a, b) => usage[b.id] - usage[a.id]);
    if ((!statsEx || !usage[statsEx]) && topEx.length) statsEx = topEx[0].id;

    let exCharts = '';
    if (statsEx) {
      const wmap = {}; workouts.forEach(w => wmap[w.id] = w);
      const series = Logic.exerciseSeries(sets.filter(s => s.exerciseId === statsEx), wmap);
      const chips = topEx.map(e => `<button class="chip ${e.id === statsEx ? 'active' : ''}" onclick="App.setStatsEx('${e.id}')">${esc(e.name)}</button>`).join('');
      exCharts = `<h2 class="section">Übungs-Entwicklung</h2><div class="chiprow">${chips}</div>`;
      if (series.length) {
        exCharts += `<div class="chart-card"><div class="ct"><span class="title">Geschätzter 1RM</span><span class="now num">${series[series.length - 1].e1rm} kg</span></div>${Charts.line(series.map(r => ({ x: r.date, y: r.e1rm })))}</div>`
                  + `<div class="chart-card"><div class="ct"><span class="title">Top-Satz Wdh.</span></div>${Charts.line(series.map(r => ({ x: r.date, y: r.topReps })))}</div>`;
      } else exCharts += '<div class="muted tiny">Noch keine Daten.</div>';
    }

    // empty state — no fake stats
    if (!done.length) {
      $('view-progress').innerHTML = `<div class="empty" style="padding:60px 20px">
        <div class="big">Noch keine Trainingsdaten</div>
        Sobald du dein erstes Training abschließt, erscheinen hier deine echten Charts:
        Volumen, Frequenz, Muskel-Balance und die Entwicklung jeder Übung.
        <div style="margin-top:18px"><button class="btn up" onclick="App.go('training')">Erstes Training starten</button></div></div>`;
      return;
    }

    let history = `<h2 class="section">Verlauf</h2>`;
    for (const w of done.slice(0, 30)) history += workoutRow(w);

    const goalsHtml = goals.length ? `<h2 class="section">Ziele</h2>${goals.map(goalCard).join('')}` : '';
    const bwHtml = bw.length
      ? `<div class="chart-card"><div class="ct"><span class="title">Körpergewicht</span><span class="now num">${bw[bw.length - 1].kg} kg</span></div>${Charts.line(bw.map(b => ({ x: b.ts, y: b.kg })))}</div>`
      : '';

    $('view-progress').innerHTML = `
      <div class="metric-grid">
        <div class="metric"><div class="k">Einheiten gesamt</div><div class="v num">${workouts.length}</div></div>
        <div class="metric"><div class="k">Diese Woche</div><div class="v num">${weekWorkouts}</div></div>
        <div class="metric"><div class="k">Volumen gesamt</div><div class="v num">${fmtK(totalVol)}</div><div class="d muted">kg</div></div>
        <div class="metric"><div class="k">Wochen-Streak</div><div class="v num">${streak}</div><div class="d muted">Wochen in Folge</div></div>
      </div>

      ${muscleMapHTML(spm)}
      <div class="card"><div class="card-h"><span>Volumen-Balance · 7 Tage</span><span class="muted tiny">MEV / MAV / MRV</span></div>${landmarkBars(spm)}</div>

      <div class="card"><div class="card-h"><span>Trainingsfrequenz · 12 Wochen</span></div>
        <div class="heatwrap">${Charts.heatCalendar(dayVol, 12)}</div>
        <div class="heatlegend"><span>weniger</span><i class="heat l0"></i><i class="heat l1"></i><i class="heat l2"></i><i class="heat l3"></i><i class="heat l4"></i><span>mehr</span></div></div>

      <div class="chart-card"><div class="ct"><span class="title">Einheiten / Woche</span></div>${Charts.bars(weekly.map(w => ({ label: w.label, value: w.sessions })))}</div>
      <div class="chart-card"><div class="ct"><span class="title">Volumen / Woche</span><span class="now num">${fmtK(weekVol)} kg</span></div>${Charts.bars(weekly.map(w => ({ label: w.label, value: Math.round((w.volume || 0) / 1000) })))}<div class="muted tiny" style="padding:2px 8px">in Tonnen (×1000 kg)</div></div>
      <div class="chart-card"><div class="ct"><span class="title">Volumen / Workout</span></div>${Charts.line(volSeries)}</div>
      ${exCharts}
      ${bwHtml}
      ${goalsHtml}
      ${history}`;
  }
  function setStatsEx(id) { statsEx = id; renderProgress(); }

  // ==========================================================
  //  PROFILE (identity + bodyweight + backup)
  // ==========================================================
  async function renderProfile() {
    const s = S.settings;
    const bw = (await DB.all('bodyweight')).sort((a, b) => b.ts - a.ts);
    const last = bw[0];
    const wCount = (await DB.all('workouts')).filter(w => w.status === 'completed').length;
    $('view-profile').innerHTML = `
      <div class="hero" style="margin-top:6px">
        <div class="hero-grid"></div>
        <div class="hero-top">
          <div class="reactor on"><span></span></div>
          <div><div class="hero-hi"><b>${esc(s.name)}</b></div>
          <div class="hero-sub">${wCount} Workouts · lokal gespeichert</div></div>
        </div>
      </div>

      <div class="card"><div class="card-h"><span>Identität</span></div>
        <div class="field2"><label>Anzeigename</label><input class="text-in" id="pfName" value="${esc(s.name)}"></div>
        <label class="tog"><span>Haptik (Vibration)</span><input type="checkbox" id="pfHap" ${s.haptics ? 'checked' : ''}></label>
        <label class="tog"><span>Sound-Feedback</span><input type="checkbox" id="pfSnd" ${s.sound ? 'checked' : ''}></label>
        <button class="btn up block" style="margin-top:12px" onclick="App.saveProfile()">Speichern</button>
      </div>

      <div class="card"><div class="card-h"><span>Körpergewicht</span>${last ? `<span class="num" style="color:var(--up)">${last.kg} kg</span>` : ''}</div>
        <div class="row" style="gap:10px;align-items:flex-end">
          <div class="field2" style="flex:1"><label>Heute (kg)</label><input class="text-in num" id="pfBw" inputmode="decimal" value="${last ? last.kg : ''}" placeholder="z.B. 74.5"></div>
          <button class="btn up" style="min-height:56px" onclick="App.saveBodyweight(true)">Log</button>
        </div>
        ${bw.length ? `<div style="margin-top:10px">${Charts.line(bw.slice().reverse().map(b => ({ x: b.ts, y: b.kg })))}</div>` : ''}
      </div>

      <div class="card"><div class="card-h"><span>Werkzeuge</span></div>
        <button class="btn ghost block" onclick="App.openPlateCalc()">Scheiben-Rechner</button>
        <button class="btn ghost block" style="margin-top:8px" onclick="App.openNewGoal()">Ziel hinzufügen</button>
      </div>

      <div class="card"><div class="card-h"><span>Daten &amp; Backup</span></div>
        <div class="row" style="gap:10px">
          <button class="btn ghost block" onclick="App.exportData()">Exportieren</button>
          <button class="btn ghost block" onclick="App.triggerImport()">Import</button>
        </div>
        <div class="muted tiny" style="margin-top:10px">Alles liegt offline auf diesem Gerät. Exportiere regelmäßig ein Backup.</div>
        <input type="file" id="importFile" accept="application/json" class="hidden" onchange="App.importData(this.files[0])">
      </div>`;
  }
  async function saveProfile() {
    S.settings.name = ($('pfName').value || 'Sam').trim() || 'Sam';
    S.settings.haptics = $('pfHap').checked;
    S.settings.sound = $('pfSnd').checked;
    await DB.metaSet('name', S.settings.name);
    await DB.metaSet('haptics', S.settings.haptics);
    await DB.metaSet('sound', S.settings.sound);
    toast('Gespeichert'); renderProfile();
  }
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
      await loadExCache(); toast('Import erfolgreich'); go(S.view);
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
    // load settings
    S.settings.name = await DB.metaGet('name', 'Sam');
    S.settings.haptics = await DB.metaGet('haptics', true);
    S.settings.sound = await DB.metaGet('sound', false);
    await loadExCache();
    // wire chrome
    document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => go(b.dataset.view));
    const scrim = $('scrim'); if (scrim) scrim.onclick = closeSheet;
    // first paint
    go('home');
    // dismiss boot overlay
    const boot = $('boot');
    if (boot) {
      const nm = boot.querySelector('.boot-name'); if (nm) nm.textContent = S.settings.name;
      setTimeout(() => boot.classList.add('done'), 1100);
      setTimeout(() => { boot.style.display = 'none'; }, 1900);
    }
  }

  // ==========================================================
  //  DASHBOARD HELPERS / EXTRAS
  // ==========================================================
  function computeWeekly(done, weeks) {
    const out = [];
    const monday = new Date(); monday.setHours(0, 0, 0, 0);
    const dow = (monday.getDay() + 6) % 7; monday.setDate(monday.getDate() - dow);
    for (let i = weeks - 1; i >= 0; i--) {
      const from = new Date(monday); from.setDate(monday.getDate() - i * 7);
      const to = new Date(from); to.setDate(from.getDate() + 7);
      const ws = done.filter(w => w.startTime >= from.getTime() && w.startTime < to.getTime());
      out.push({ label: `${from.getDate()}.${from.getMonth() + 1}`, sessions: ws.length, volume: ws.reduce((a, w) => a + (w.totalVolume || 0), 0) });
    }
    return out;
  }

  function runCountUps() {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('#view-home [data-count]').forEach(el => {
      const to = parseFloat(el.getAttribute('data-count')) || 0;
      if (reduce || to === 0) { el.textContent = to; return; }
      const t0 = performance.now(), d = 650;
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / d);
        el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // optional sound feedback (no files, WebAudio)
  let _ac = null;
  function beep(freq = 880) {
    if (!S.settings || !S.settings.sound) return;
    try {
      _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = _ac.createOscillator(), g = _ac.createGain();
      o.type = 'sine'; o.frequency.value = freq; o.connect(g); g.connect(_ac.destination);
      g.gain.setValueAtTime(0.0001, _ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, _ac.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, _ac.currentTime + 0.25);
      o.start(); o.stop(_ac.currentTime + 0.26);
    } catch (e) {}
  }

  // full-screen PR moment
  function showPR(flags, set, exName) {
    const ov = $('prOverlay'); if (!ov) return;
    ov.innerHTML = `<div class="pr-card">
      <div class="pr-badge-xl">🏆</div>
      <div class="pr-title">NEW RECORD</div>
      <div class="pr-ex">${esc(exName)}</div>
      <div class="pr-big num">${set.weight} kg × ${set.reps}</div>
      <div class="pr-kind">${esc(Logic.PR_LABEL[flags[0]])}${flags.length > 1 ? ` · +${flags.length - 1} weitere` : ''}</div>
      <div class="pr-tap muted tiny">tippen zum Schließen</div></div>`;
    ov.classList.add('show');
    vibrate([20, 40, 20, 40, 60]); beep(1180);
    clearTimeout(ov._t); ov._t = setTimeout(() => ov.classList.remove('show'), 1700);
    ov.onclick = () => { clearTimeout(ov._t); ov.classList.remove('show'); };
  }

  // ---- overload suggestion (pre-fill helper) ----
  async function computeSuggestion(id) {
    const e = ex(id); if (!e) { return; }
    const activeId = S.active && S.active.id;
    const hist = (await DB.byIndex('sets', 'exerciseId', id)).filter(s => s.workoutId !== activeId);
    if (!hist.length) { S.suggestByEx[id] = null; return; }
    const byW = {}; hist.forEach(s => (byW[s.workoutId] ||= []).push(s));
    const latest = Object.keys(byW).sort((a, b) =>
      Math.max(...byW[b].map(s => s.timestamp)) - Math.max(...byW[a].map(s => s.timestamp)))[0];
    const lastSets = byW[latest].filter(Logic.isWorking).sort((a, b) => a.timestamp - b.timestamp);
    S.lastByEx[id] = { sets: lastSets, ts: Math.max(...byW[latest].map(s => s.timestamp)) };
    S.suggestByEx[id] = Logic.overloadSuggestion(e, byW[latest]);
  }
  function applySuggestion() {
    const sug = S.suggestByEx[S.curEx]; if (!sug) return;
    S.entry = { weight: sug.weight, reps: sug.reps, rir: sug.rir, setType: 'working' };
    refreshLiveBody(); toast('Vorschlag übernommen'); vibrate(10);
  }

  // ==========================================================
  //  PLATE CALCULATOR + WARMUP RAMP
  // ==========================================================
  let _bar = 20;
  function openPlateCalc() {
    openSheet(`<div class="grab"></div><h3>Scheiben-Rechner</h3>
      <div class="row" style="gap:10px">
        <div class="field2"><label>Zielgewicht</label><input class="text-in num" id="pcTarget" inputmode="decimal" value="60" oninput="App.calcPlates()"></div>
        <div class="field2"><label>Stange (kg)</label><input class="text-in num" id="pcBar" inputmode="decimal" value="${_bar}" oninput="App.calcPlates()"></div>
      </div>
      <div id="pcOut" class="pc-out"></div>
      <h3 style="margin-top:20px">Aufwärm-Rampe</h3>
      <div id="pcWarm" class="pc-warm"></div>`);
    calcPlates();
  }
  function calcPlates() {
    const target = parseFloat(($('pcTarget').value || '0').replace(',', '.')) || 0;
    const bar = parseFloat(($('pcBar').value || '20').replace(',', '.')) || 20; _bar = bar;
    const perSide = (target - bar) / 2;
    const out = $('pcOut');
    if (perSide < 0) out.innerHTML = `<div class="muted tiny">Ziel liegt unter dem Stangengewicht.</div>`;
    else {
      const plates = [25, 20, 15, 10, 5, 2.5, 1.25]; let rem = perSide; const used = [];
      for (const p of plates) { const n = Math.floor(rem / p + 1e-9); if (n > 0) { used.push([p, n]); rem -= n * p; } }
      const chips = used.map(([p, n]) => `<span class="plate">${n}×${p}</span>`).join('') || '<span class="muted tiny">nur Stange</span>';
      const rest = rem > 0.01 ? `<div class="muted tiny">Rest ${Math.round(rem * 100) / 100} kg nicht darstellbar</div>` : '';
      out.innerHTML = `<div class="muted tiny">pro Seite ${Math.round(perSide * 100) / 100} kg</div><div class="plates">${chips}</div>${rest}`;
    }
    const warm = $('pcWarm');
    if (target > bar) {
      const steps = [['Stange', bar], ['40%', bar + (target - bar) * 0.4], ['60%', bar + (target - bar) * 0.6], ['80%', bar + (target - bar) * 0.8], ['Arbeit', target]];
      warm.innerHTML = steps.map(([l, w]) => `<div class="warm-row"><span>${l}</span><b class="num">${Math.round(w / 2.5) * 2.5} kg</b></div>`).join('');
    } else warm.innerHTML = `<div class="muted tiny">—</div>`;
  }

  // ==========================================================
  //  BODYWEIGHT
  // ==========================================================
  async function openBodyweight() {
    const bw = (await DB.all('bodyweight')).sort((a, b) => b.ts - a.ts);
    const last = bw[0];
    const list = bw.slice(0, 10).map(b => `<div class="list-item"><div class="name num">${b.kg} kg</div><div class="mg">${dateLabel(b.date)}</div></div>`).join('') || '<div class="muted tiny">Noch nichts geloggt.</div>';
    openSheet(`<div class="grab"></div><h3>Körpergewicht</h3>
      <div class="row" style="gap:10px;align-items:flex-end">
        <div class="field2" style="flex:1"><label>Heute (kg)</label><input class="text-in num" id="bwIn" inputmode="decimal" value="${last ? last.kg : ''}" placeholder="z.B. 74.5"></div>
        <button class="btn up" style="min-height:56px" onclick="App.saveBodyweight()">Speichern</button>
      </div>
      <h3 style="margin-top:18px">Verlauf</h3>${list}`);
  }
  async function saveBodyweight(fromProfile) {
    const el = fromProfile ? $('pfBw') : $('bwIn');
    const v = parseFloat(((el && el.value) || '').replace(',', '.'));
    if (!v || v < 20 || v > 400) { toast('Ungültiges Gewicht'); return; }
    await DB.put('bodyweight', { id: DB.uid('bw_'), ts: Date.now(), date: today(), kg: Math.round(v * 10) / 10 });
    toast('Gewicht gespeichert');
    if (fromProfile) renderProfile(); else { closeSheet(); renderHome(); }
  }

  // ==========================================================
  //  SETTINGS (name, haptics, sound)
  // ==========================================================
  function openSettings() {
    const s = S.settings;
    openSheet(`<div class="grab"></div><h3>Einstellungen</h3>
      <div class="field2"><label>Anzeigename</label><input class="text-in" id="setName" value="${esc(s.name)}"></div>
      <label class="tog"><span>Haptik (Vibration)</span><input type="checkbox" id="setHap" ${s.haptics ? 'checked' : ''}></label>
      <label class="tog"><span>Sound-Feedback</span><input type="checkbox" id="setSnd" ${s.sound ? 'checked' : ''}></label>
      <button class="btn up block" style="margin-top:16px" onclick="App.saveSettings()">Speichern</button>
      <div class="muted tiny" style="margin-top:14px;text-align:center">Alle Daten liegen lokal auf diesem Gerät.</div>`);
  }
  async function saveSettings() {
    S.settings.name = ($('setName').value || 'Sam').trim() || 'Sam';
    S.settings.haptics = $('setHap').checked;
    S.settings.sound = $('setSnd').checked;
    await DB.metaSet('name', S.settings.name);
    await DB.metaSet('haptics', S.settings.haptics);
    await DB.metaSet('sound', S.settings.sound);
    closeSheet(); renderHome();
  }

  return {
    init, go, startWorkout, resumeWorkout, minimizeWorkout, finishWorkout,
    selectEx, openExercisePicker, filterPicker, pickExercise, openNewExercise, saveNewExercise,
    step, setEntry, setType, saveSet, deleteSet, repeatLast,
    setExFilter, openExercise, openWorkout, deleteWorkout,
    openTemplates, runTemplate, saveAsTemplate,
    openNewGoal, goalTypeChanged, saveGoal, editGoal,
    renderProgress, renderProfile, saveProfile, setStatsEx, exportData, triggerImport, importData, repeatLastWorkout,
    addRest, skipRest, applySuggestion,
    openPlateCalc, calcPlates, openBodyweight, saveBodyweight,
    openSettings, saveSettings,
    setBodyView, muscleTap, closeSheetGo,
  };
})();

window.DB = DB; window.Logic = Logic; window.Charts = Charts; window.Anatomy = Anatomy; window.App = App;
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', App.init);
else App.init();
