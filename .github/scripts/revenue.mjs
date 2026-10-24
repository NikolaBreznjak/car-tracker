#!/usr/bin/env node
// Applies one revenue event to the JSON "database" in data/ (run by .github/workflows/revenue.yml; also runnable locally).
//
//   EVENT=add-revenue PAYLOAD='{"goal":"default","amount":1500,"note":"Acme plan"}' node .github/scripts/revenue.mjs
//   EVENT=set-state   PAYLOAD='{"goal":"default","raised":38400,"target":164500,"car":"m3-g80","label":"Acme MRR"}' node .github/scripts/revenue.mjs
//
// Files (all public — this repo is public):
//   data/goals/<id>.json    { id, label, car, goal, raised, demo, updatedAt, events }     one tracker ("goal")
//   data/history/<id>.json  { id, events: [{ ts, type, amount, note, raised, id? }] }     last MAX_EVENTS events, oldest first
//   data/index.json         { goals: [{ id, label, car, goal, raised }], updatedAt }      list for the embed builder
//   data/state.json         copy of the 'default' goal (backwards-compatible single-tracker URL)
// Payload fields (validated; anything else is ignored):
//   goal    tracker id, [a-z0-9-]{1,40}, default "default"
//   amount  add-revenue: finite number, |amount| <= 1e9 (negative = refund; the total never goes below 0)
//   note    optional string <= 140 chars (control chars stripped)
//   id      optional idempotency key [A-Za-z0-9._:-]{1,64}: an event whose id is already in the history is skipped
//   ts      optional ISO timestamp for back-filling (defaults to now)
//   set-state: raised (>= 0), target (goal amount > 0, or null = the car's price), car ([a-z0-9-]), label (<= 60), demo (bool), reset (bool: clear history)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.DATA_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
const MAX_EVENTS = 1000, MAX_GOALS = 100;
const DEFAULTS = { label: 'Some revenue', car: 'carrera-4s', goal: null };
const ID_RE = /^[a-z0-9-]{1,40}$/, CAR_RE = /^[a-z0-9-]{1,40}$/, EVID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

const fail = (msg) => { console.log(`::error::${msg}`); console.error('invalid payload: ' + msg); process.exit(2); };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 2) + '\n'); fs.renameSync(f + '.tmp', f); };
const cleanStr = (s, max, name) => {
  if (typeof s !== 'string') fail(`"${name}" must be a string`);
  const t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (t.length > max) fail(`"${name}" must be at most ${max} characters`);
  return t;
};
const num = (v, name) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;   // workflow_dispatch inputs arrive as strings
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(`"${name}" must be a finite number`);
  return n;
};
const round2 = (n) => Math.round(n * 100) / 100;
const bool = (v) => v === true || v === 'true' || v === '1';

// ---- input ----
const EVENT = process.env.EVENT;
if (!['add-revenue', 'set-state'].includes(EVENT)) fail('event must be add-revenue or set-state');
let P;
try { P = JSON.parse(process.env.PAYLOAD || '{}'); } catch { fail('payload is not valid JSON'); }
if (!P || typeof P !== 'object' || Array.isArray(P)) fail('payload must be an object');
// workflow_dispatch: empty strings mean "not given"
for (const k of Object.keys(P)) if (P[k] === '' || P[k] === null && k !== 'target') delete P[k];

const id = P.goal === undefined ? 'default' : String(P.goal);
if (!ID_RE.test(id)) fail('"goal" must match [a-z0-9-]{1,40}');
let ts = new Date().toISOString();
if (P.ts !== undefined) { const d = new Date(P.ts); if (isNaN(d) || d.getTime() > Date.now() + 5 * 60e3 || d.getFullYear() < 2000) fail('"ts" must be an ISO timestamp, not in the future'); ts = d.toISOString(); }
let evId;
if (P.id !== undefined) { evId = String(P.id); if (!EVID_RE.test(evId)) fail('"id" must match [A-Za-z0-9._:-]{1,64}'); }

// ---- load ----
const goalFile = path.join(ROOT, 'goals', id + '.json'), histFile = path.join(ROOT, 'history', id + '.json'), indexFile = path.join(ROOT, 'index.json');
const index = readJson(indexFile, { goals: [] });
const exists = fs.existsSync(goalFile);
if (!exists && index.goals.length >= MAX_GOALS) fail(`too many goals (max ${MAX_GOALS})`);
const G = { id, ...DEFAULTS, raised: 0, ...readJson(goalFile, {}) };
const H = readJson(histFile, { id, events: [] });
if (evId && H.events.some((e) => e.id === evId)) { console.log(`event ${evId} already applied — skipping`); process.exit(0); }

// ---- apply ----
let ev;
if (EVENT === 'add-revenue') {
  if (P.amount === undefined) fail('"amount" is required');
  const amount = round2(num(P.amount, 'amount'));
  if (Math.abs(amount) > 1e9) fail('"amount" is out of range (|amount| <= 1e9)');
  if (amount === 0) fail('"amount" must not be 0');
  const note = P.note === undefined ? '' : cleanStr(P.note, 140, 'note');
  if (P.label !== undefined && !exists) G.label = cleanStr(P.label, 60, 'label');
  if (P.car !== undefined && !exists) { if (!CAR_RE.test(String(P.car))) fail('"car" must match [a-z0-9-]{1,40}'); G.car = String(P.car); }
  G.raised = Math.max(0, round2(G.raised + amount));
  ev = { ts, type: 'add', amount, raised: G.raised };
  if (note) ev.note = note;
} else {
  let touched = false;
  if (P.raised !== undefined) { const r = round2(num(P.raised, 'raised')); if (r < 0 || r > 1e12) fail('"raised" must be between 0 and 1e12'); G.raised = r; touched = true; }
  if ('target' in P) { if (P.target === null || P.target === 'null' || P.target === '') G.goal = null; else { const t = round2(num(P.target, 'target')); if (t <= 0 || t > 1e12) fail('"target" must be > 0'); G.goal = t; } touched = true; }
  if (P.car !== undefined) { if (!CAR_RE.test(String(P.car))) fail('"car" must match [a-z0-9-]{1,40}'); G.car = String(P.car); touched = true; }
  if (P.label !== undefined) { G.label = cleanStr(P.label, 60, 'label'); touched = true; }
  if (P.demo !== undefined) { G.demo = bool(P.demo); touched = true; }
  if (bool(P.reset)) { H.events = []; touched = true; }
  if (!touched) fail('set-state needs at least one of raised, target, car, label, demo, reset');
  ev = { ts, type: 'set', raised: G.raised };
  if (P.note !== undefined) ev.note = cleanStr(P.note, 140, 'note');
}
if (EVENT === 'add-revenue' || P.demo === undefined) delete G.demo;   // real data switches off the demo autoplay
if (evId) ev.id = evId;
if (!(EVENT === 'set-state' && bool(P.reset) && P.raised === undefined)) H.events.push(ev);
H.events.sort((a, b) => a.ts.localeCompare(b.ts));
if (H.events.length > MAX_EVENTS) H.events.splice(0, H.events.length - MAX_EVENTS);
G.updatedAt = new Date().toISOString();
G.events = H.events.length;

// ---- save ----
writeJson(goalFile, G);
writeJson(histFile, H);
const entry = { id, label: G.label, car: G.car, goal: G.goal, raised: G.raised, updatedAt: G.updatedAt };
index.goals = [...index.goals.filter((g) => g.id !== id), entry].sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.id.localeCompare(b.id)));
index.updatedAt = G.updatedAt;
writeJson(indexFile, index);
if (id === 'default') writeJson(path.join(ROOT, 'state.json'), G);
console.log(`${EVENT} ${id}: raised=${G.raised} goal=${G.goal ?? 'car default'} car=${G.car} events=${H.events.length}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${EVENT} ${id}: ${EVENT === 'add-revenue' ? (ev.amount > 0 ? '+' : '') + ev.amount : 'raised ' + G.raised} -> ${G.raised}\n`);
