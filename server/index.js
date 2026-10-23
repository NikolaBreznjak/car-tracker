#!/usr/bin/env node
// Zero-dependency revenue API + static host. Node 18+.
//   GET  /api/state               public, CORS-enabled
//   POST /api/revenue {amount,note?}      Authorization: Bearer $API_KEY  -> adds to total
//   POST /api/state   {raised?,goal?,car?,label?}  Authorization: Bearer $API_KEY -> set absolute values
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const API_KEY = process.env.API_KEY || '';
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'state.json'));
const ROOT = path.resolve(__dirname, '..');
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_HISTORY = 200;

const DEFAULTS = {
  raised: Number(process.env.DEFAULT_RAISED) || 0,
  goal: Number(process.env.DEFAULT_GOAL) || null,
  car: process.env.DEFAULT_CAR || 'carrera-4s',
  label: process.env.DEFAULT_LABEL || 'Some revenue',
};

let state = { ...DEFAULTS, updatedAt: new Date().toISOString(), history: [] };
try { state = { ...state, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch (e) { /* first run */ }

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('persist failed:', e.message); }
}
const publicState = () => {
  const o = { raised: state.raised, car: state.car, label: state.label, updatedAt: state.updatedAt };
  if (state.goal) o.goal = state.goal;
  return o;
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const STATIC_ALLOW = /^\/(index\.html|css\/|js\/|vendor\/|fonts\/|models\/|favicon)/;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function authed(req) {
  if (!API_KEY) return null; // writes disabled
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return false;
  const a = crypto.createHash('sha256').update(m[1]).digest(), b = crypto.createHash('sha256').update(API_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 16 * 1024) { reject(Object.assign(new Error('body too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('invalid JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const log = (type, data) => { state.history.push({ t: new Date().toISOString(), type, ...data }); if (state.history.length > MAX_HISTORY) state.history.splice(0, state.history.length - MAX_HISTORY); };

async function api(req, res, pathname) {
  if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, publicState());
  if (pathname === '/healthz') return json(res, 200, { ok: true });
  if (req.method !== 'POST' || (pathname !== '/api/revenue' && pathname !== '/api/state')) return json(res, 404, { error: 'not found' });
  const a = authed(req);
  if (a === null) return json(res, 503, { error: 'writes disabled: set the API_KEY environment variable' });
  if (!a) { res.setHeader('WWW-Authenticate', 'Bearer'); return json(res, 401, { error: 'unauthorized' }); }
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, e.code || 400, { error: e.message }); }

  if (pathname === '/api/revenue') {
    if (!isNum(body.amount)) return json(res, 400, { error: '"amount" must be a number' });
    state.raised = Math.max(0, Math.round((state.raised + body.amount) * 100) / 100);
    log('revenue', { amount: body.amount, note: typeof body.note === 'string' ? body.note.slice(0, 200) : undefined, raised: state.raised });
  } else {
    let touched = false;
    if (body.raised !== undefined) { if (!isNum(body.raised) || body.raised < 0) return json(res, 400, { error: '"raised" must be a number >= 0' }); state.raised = body.raised; touched = true; }
    if (body.goal !== undefined) { if (body.goal !== null && (!isNum(body.goal) || body.goal <= 0)) return json(res, 400, { error: '"goal" must be a positive number or null' }); state.goal = body.goal; touched = true; }
    if (body.car !== undefined) { if (typeof body.car !== 'string' || body.car.length > 60) return json(res, 400, { error: '"car" must be a string' }); state.car = body.car; touched = true; }
    if (body.label !== undefined) { if (typeof body.label !== 'string' || body.label.length > 80) return json(res, 400, { error: '"label" must be a string (<=80)' }); state.label = body.label; touched = true; }
    if (!touched) return json(res, 400, { error: 'nothing to update (raised, goal, car, label)' });
    log('set', { raised: state.raised, goal: state.goal, car: state.car, label: state.label });
  }
  state.updatedAt = new Date().toISOString();
  save();
  return json(res, 200, publicState());
}

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (!STATIC_ALLOW.test(pathname)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(ROOT, path.normalize(pathname));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  try {
    if (pathname.startsWith('/api/') || pathname === '/healthz') return await api(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, pathname);
  } catch (e) { console.error(e); json(res, 500, { error: 'server error' }); }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`car-tracker on :${PORT}  data=${DATA_FILE}  writes=${API_KEY ? 'enabled' : 'DISABLED (set API_KEY)'}`));
}
module.exports = server;
