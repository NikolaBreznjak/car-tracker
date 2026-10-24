import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARS, DEFAULT_CAR, DEFAULT_STAGES, getCar } from './cars.js';
import { buildCoupe } from './carbuilder.js';
import { buildGltfCar } from './gltfcar.js';
import { parseParams, DataSource } from './data.js';

const BUILDERS = { coupe: buildCoupe, gltf: buildGltfCar };
const P = parseParams();
const $ = (id) => document.getElementById(id);
if (P.embed) document.body.classList.add('embed');
if (P.embed && P.header) document.body.classList.add('show-header');
if (!P.chart) document.body.classList.add('no-chart');

// ---------------- state ----------------
const S = {
  car: getCar(P.car || DEFAULT_CAR),
  raisedTarget: 0,   // what the data source says
  raisedShown: 0,    // animated value
  goal: null,
  label: null,
  mode: 'build',     // 'build' | 'finish' (preview)
  source: 'demo',
  demoPlaying: false,
  liveRaised: 0,     // last value the live source (API / ?raised= / demo) reported
  manual: false,     // the user is overriding the live value by dragging
  manualUntil: 0,    // performance.now() ms until which live updates stay paused
  dragging: false,
  history: [],       // [{ts, type: 'add'|'set', amount?, note?, raised}] oldest first
  lowPower: false,
  onscreen: true,    // stage visible in the viewport (IntersectionObserver) — rendering pauses when not
};
const goal = () => P.target ?? S.goal ?? S.car.goal;
const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ---------------- three.js scene ----------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// studio environment: the stock RoomEnvironment plus long soft-boxes, so the paint gets crisp highlight lines
function studioEnv() {
  const env = new RoomEnvironment();
  env.traverse((o) => { // darker room, so the soft-boxes read as crisp highlights on the paint
    if (o.isMesh && o.material.isMeshStandardMaterial) { o.material = o.material.clone(); o.material.color.setScalar(o.material.side === THREE.BackSide ? 0.16 : 0.4); }
  });
  const box = new THREE.BoxGeometry();
  const strip = (i, pos, scale) => {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(i) }));
    m.position.set(...pos); m.scale.set(...scale); env.add(m);
  };
  strip(14, [0, 7, 0], [12, 0.15, 1.6]);        // long overhead strip
  strip(9, [-9, 3.2, 4], [0.15, 1.1, 9]);       // side strips (rim highlights along the flanks)
  strip(9, [9, 3.2, -4], [0.15, 1.1, 9]);
  strip(6, [0, 2.6, 10], [8, 0.9, 0.15]);       // front/back kickers
  return env;
}
const pmrem = new THREE.PMREMGenerator(renderer);
{ const e = studioEnv(); scene.environment = pmrem.fromScene(e, 0.035).texture; e.dispose(); }
scene.environmentIntensity = 0.85;

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const HOME = { pos: new THREE.Vector3(2.8, 1.15, 3.45), target: new THREE.Vector3(0, 0.5, 0) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true; controls.dampingFactor = 0.07;
controls.enablePan = false;
if (matchMedia('(max-width: 900px)').matches) canvas.style.touchAction = 'pan-y'; // let the page scroll vertically on mobile
controls.minDistance = 3.4; controls.maxDistance = 13;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.autoRotate = true; controls.autoRotateSpeed = 0.55;
{ // optional fixed view: ?az=DEG&el=DEG (az 0 = front, 90 = right side)
  const q = new URLSearchParams(location.search);
  if (q.has('az')) {
    const az = THREE.MathUtils.degToRad(+q.get('az')), el = THREE.MathUtils.degToRad(+(q.get('el') || 12)), d = +(q.get('d') || 7.4);
    HOME.pos.set(Math.cos(el) * Math.cos(az) * d, Math.sin(el) * d + 0.55, Math.cos(el) * Math.sin(az) * d);
    camera.position.copy(HOME.pos); controls.autoRotate = false;
  }
}
let idleTimer = null;
controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idleTimer); });
controls.addEventListener('end', () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => (controls.autoRotate = true), 3500); });

// lights: soft key (env does the heavy lifting) + cool fill; no coloured rim (it painted a lime stripe on the clearcoat)
const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(4, 7, 5); scene.add(key);
const fill = new THREE.DirectionalLight(0x8fb4ff, 0.35); fill.position.set(-4, 2, 6); scene.add(fill);

// ground: faint reflective floor (mirrored car shows through it), light pool, soft contact shadow, lime ring
function radialTex(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const floorMat = new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(22,23,23,.8)'], [0.5, 'rgba(22,23,23,.8)'], [0.78, 'rgba(22,23,23,.45)'], [1, 'rgba(22,23,23,0)']], 512), transparent: true, depthWrite: false, toneMapped: false }); // ~20% of the mirrored car shows through
const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 64), floorMat);   // fades out inside the view, so the canvas edge never shows as a box
floor.rotation.x = -Math.PI / 2; floor.position.y = 0.0005; floor.renderOrder = -2; scene.add(floor);
const pool = new THREE.Mesh(new THREE.CircleGeometry(3.6, 64), new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(255,255,255,.075)'], [0.6, 'rgba(255,255,255,.03)'], [1, 'rgba(255,255,255,0)']], 256), transparent: true, depthWrite: false }));
pool.rotation.x = -Math.PI / 2; pool.position.y = 0.0008; pool.renderOrder = -2; scene.add(pool);
function shadowTex(w = 512, h = 256) { // top-down footprint: blurred body + darker blobs under each tyre
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  const blob = (cx, cy, rx, ry, a) => { g.save(); g.translate(cx, cy); g.scale(rx, ry); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.55, `rgba(0,0,0,${a * 0.55})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); g.restore(); };
  blob(w / 2, h / 2, w * 0.5, h * 0.5, 0.55);
  blob(w / 2, h / 2, w * 0.4, h * 0.36, 0.7);
  return c;
}
const shadowCanvas = shadowTex();
const shadowTexture = new THREE.CanvasTexture(shadowCanvas); shadowTexture.colorSpace = THREE.SRGBColorSpace;
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }));
shadow.rotation.x = -Math.PI / 2; shadow.scale.set(6.4, 3.3, 1); shadow.position.y = 0.002; shadow.renderOrder = -1; scene.add(shadow);
const wheelShadows = new THREE.Group(); scene.add(wheelShadows);
const wsTex = radialTex([[0, 'rgba(0,0,0,.8)'], [0.5, 'rgba(0,0,0,.45)'], [1, 'rgba(0,0,0,0)']], 128);
const ring = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.015, 128), new THREE.MeshBasicMaterial({ color: 0xc4d300, transparent: true, opacity: 0.18, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.003; ring.renderOrder = -1; scene.add(ring);

let carObj = null, carLoaded = false;
const levels = [0, 0, 0, 0, 0, 0];   // smoothed
let levelTargets = [0, 0, 0, 0, 0, 0];
let replay = 0;

function loadCar() {
  if (carObj) {   // free the previous car's GPU memory (geometries, materials, textures); only the selected GLB is ever downloaded
    scene.remove(carObj);
    if (carObj.userData.dispose) carObj.userData.dispose(); else carObj.traverse((o) => { o.geometry && o.geometry.dispose(); });
  }
  const b = typeof S.car.builder === 'function' ? S.car.builder : BUILDERS[S.car.builder] || buildCoupe;
  const mine = (carObj = b(S.car, renderer));
  if (carObj.userData.setLowPower) carObj.userData.setLowPower(S.lowPower);
  scene.add(carObj); carLoaded = true;
  const loading = $('loading'); if (loading) loading.classList.toggle('show', carObj.userData.state === 'loading');
  // contact shadows follow this car's wheelbase / length (re-run once an async model has loaded)
  const fitShadows = () => {
    if (mine !== carObj) return;
    if (loading && carObj.userData.state !== 'loading') loading.classList.remove('show');
    const bd = carObj.userData.bounds; if (!bd) return;
    const len = bd.x1 - bd.x0; shadow.scale.set(len * 1.42, 3.3, 1); shadow.position.x = (bd.x0 + bd.x1) / 2;
    wheelShadows.clear();
    for (const w of carObj.userData.wheels) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.5), new THREE.MeshBasicMaterial({ map: wsTex, transparent: true, depthWrite: false, toneMapped: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(w.x, 0.003, w.z); m.renderOrder = -1; wheelShadows.add(m);
    }
  };
  fitShadows();
  carObj.userData.onReady = fitShadows;
}

let userZoomed = false;
controls.addEventListener('start', () => { userZoomed = true; });
const FIXED_VIEW = new URLSearchParams(location.search).has('az');
function resize() {
  const r = $('stage').getBoundingClientRect();
  const w = Math.max(10, r.width), h = Math.max(10, r.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  controls.minDistance = 3.4; controls.maxDistance = 16;
  if (!FIXED_VIEW) {
    // fit the car's length (~2.5 m each side of centre) inside the horizontal field of view at any aspect ratio
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
    const dFit = Math.min(15, Math.max(5.2, 2.5 / tanH));
    const dir = HOME.pos.clone().sub(HOME.target).normalize();
    HOME.pos.copy(HOME.target).addScaledVector(dir, dFit);
    if (!userZoomed) { const cdir = camera.position.clone().sub(controls.target).normalize(); camera.position.copy(controls.target).addScaledVector(cdir, dFit); }
  }
}
addEventListener('resize', resize);

// ---------------- UI ----------------
function buildStageList() {
  const ul = $('stages'); ul.innerHTML = '';
  (S.car.stages || DEFAULT_STAGES).forEach((name) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot"></span><span class="txt"><span class="name"></span><span class="sub">Coming together</span></span>`;
    li.querySelector('.name').textContent = name; ul.appendChild(li);
  });
}
function buildSelector() {
  const el = $('carSelect'); el.innerHTML = '';
  Object.values(CARS).filter((c) => !c.hidden || c.id === S.car.id).forEach((c) => {
    const b = document.createElement('button'); b.textContent = c.name; b.className = c.id === S.car.id ? 'on' : '';
    if (c.soon) { b.disabled = true; b.classList.add('soon'); b.title = 'Needs a free 3D model — see README → Adding the Velar'; b.textContent = c.name + ' · soon'; el.appendChild(b); return; }
    b.onclick = () => { const u = new URL(location.href); u.searchParams.set('car', c.id); history.replaceState(null, '', u); P.car = c.id; setCar(c.id); };
    el.appendChild(b);
  });
}
function applyCarText() {
  const c = S.car;
  $('garageNo').textContent = c.garageNo; $('carName').textContent = c.name; $('carColor').textContent = c.colorName; $('carModel').textContent = c.model;
  $('watermark').textContent = c.watermark; $('tagline').textContent = c.tagline;
  const cr = $('credit'); if (cr) { cr.innerHTML = ''; if (c.credit) { const a = document.createElement('a'); a.href = c.credit.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = c.credit.text; cr.appendChild(a); } }
  document.title = `${c.name} — One sale closer.`;
}
function setCar(id) {
  S.car = getCar(id); applyCarText(); buildStageList(); buildSelector(); prevCompleted = null;
  if (carLoaded) { loadCar(); levels.fill(0); }
  renderUI(true); renderHistory();
}

let lastKey = '';
let prevCompleted = null;   // stage count at the last render (toasts fire when it goes up)
let toastQuiet = true;      // no toasts for the initial count-up to the stored value
let quietUntilSettled = false;

// ---------------- toasts ("Wheels & brakes locked in") ----------------
function toast(text, sub) {
  const box = $('toasts'); if (!box) return;
  while (box.children.length >= 3) box.firstChild.remove();
  const el = document.createElement('div'); el.className = 'toast';
  el.innerHTML = '<span class="tk">✓</span><span class="tt"></span><span class="ts"></span>';
  el.querySelector('.tt').textContent = text; el.querySelector('.ts').textContent = sub || '';
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 450); }, 3200);
}

// ---------------- revenue history: sparkline + recent list ----------------
const money = (n) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
function relTime(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.round(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function renderHistory() {
  const box = $('history'); if (!box) return;
  const ev = S.history.filter((e) => e && e.ts && typeof e.raised === 'number');
  box.hidden = !ev.length;
  if (!ev.length) return;
  // cumulative revenue as a step line: start value before the first event, then each event's resulting total, extended to now
  const t = (e) => new Date(e.ts).getTime();
  const first = ev[0], start = Math.max(0, first.raised - (first.type === 'add' ? first.amount || 0 : 0));
  const pts = [[t(first), start], ...ev.map((e) => [t(e), e.raised])];
  const now = Math.max(Date.now(), pts[pts.length - 1][0]);
  let t0 = pts[0][0], t1 = now; if (t1 - t0 < 60e3) t0 = t1 - 60e3;
  const W = 300, H = 56, top = 5;
  const ymax = Math.max(goal(), ...pts.map((p) => p[1])) || 1;
  const X = (x) => ((x - t0) / (t1 - t0)) * W, Y = (y) => H - (y / ymax) * (H - top);
  let d = `M${X(pts[0][0]).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += `H${X(pts[i][0]).toFixed(1)}V${Y(pts[i][1]).toFixed(1)}`;
  d += `H${W}`;
  const last = pts[pts.length - 1];
  $('sparkLine').setAttribute('d', d);
  $('sparkArea').setAttribute('d', d + `V${H}H${X(pts[0][0]).toFixed(1)}Z`);
  $('sparkGoal').setAttribute('y1', Y(goal()).toFixed(1)); $('sparkGoal').setAttribute('y2', Y(goal()).toFixed(1));
  $('sparkDot').setAttribute('cx', W); $('sparkDot').setAttribute('cy', Y(last[1]).toFixed(1));
  const adds = ev.filter((e) => e.type === 'add').length;
  $('histMeta').textContent = `${adds} ${adds === 1 ? 'entry' : 'entries'} · since ${new Date(pts[0][0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const ul = $('recent'); ul.innerHTML = '';
  ev.slice(-5).reverse().forEach((e) => {
    const li = document.createElement('li');
    const amt = document.createElement('span'); amt.className = 'ra ' + (e.type === 'set' ? 'set' : (e.amount || 0) < 0 ? 'neg' : 'pos');
    amt.textContent = e.type === 'set' ? '= ' + money(e.raised) : ((e.amount || 0) >= 0 ? '+' : '') + money(e.amount || 0);
    const note = document.createElement('span'); note.className = 'rn'; note.textContent = e.note || (e.type === 'set' ? 'total set' : 'revenue');
    const tm = document.createElement('time'); tm.className = 'rt'; tm.dateTime = e.ts; tm.textContent = relTime(e.ts); tm.title = new Date(e.ts).toLocaleString();
    li.append(amt, note, tm); ul.appendChild(li);
  });
}
setInterval(() => { if (!document.hidden && S.history.length) renderHistory(); }, 30000);
function renderUI(force) {
  const g = goal(), shown = S.raisedShown, pct = clamp01(g > 0 ? shown / g : 0);
  const th = S.car.thresholds;
  $('amount').textContent = fmt(shown);
  const aria = (el) => { el.setAttribute('aria-valuenow', Math.round(shown)); el.setAttribute('aria-valuemax', Math.round(g)); el.setAttribute('aria-valuetext', fmt(shown) + ', ' + Math.round(pct * 100) + '% funded'); };
  aria($('amount')); aria($('barHit'));
  $('label').textContent = (P.label ?? S.label ?? S.car.label).toUpperCase();
  const pv = pct >= 0.9999 ? 100 : pct * 100 >= 10 ? Math.min(99, Math.round(pct * 100)) : pct === 0 ? 0 : Math.max(0.1, Math.floor(pct * 1000) / 10);
  const pctTxt = pv + '% funded';
  $('pct').textContent = pctTxt; $('of').textContent = 'of ' + fmt(g);
  $('fill').style.width = pct * 100 + '%'; $('thumb').style.left = pct * 100 + '%';
  const togo = $('togo'); const done = pct >= 0.9999;
  togo.textContent = done ? 'You made it.' : fmt(Math.max(0, g - shown)) + ' to the finish line'; togo.classList.toggle('done', done);
  // stages
  const lis = $('stages').children; let completed = 0, activeIdx = -1;
  for (let i = 0; i < 6; i++) { if (pct >= th[i] - 1e-9) completed++; }
  if (prevCompleted !== null && completed > prevCompleted && !toastQuiet && S.mode === 'build') {
    const names = S.car.stages || DEFAULT_STAGES, fresh = names.slice(prevCompleted, completed);
    if (fresh.length > 2) toast(`${fresh.length} stages locked in`, fresh[fresh.length - 1]);
    else fresh.forEach((n, k) => toast(`${n} locked in`, completed - fresh.length + k + 1 + ' / 6'));
  }
  prevCompleted = completed;
  if (pct > 0 && completed < 6) activeIdx = completed;
  for (let i = 0; i < lis.length; i++) { lis[i].className = i < completed ? 'done' : i === activeIdx ? 'active' : ''; }
  $('count').textContent = `${completed} / 6`;
  $('banner').classList.toggle('show', done);
  $('leave').textContent = done ? 'BUILD COMPLETE' : 'LEAVE ASSEMBLY'; $('leave').classList.toggle('done', done);
  // 3D targets
  const p3 = S.mode === 'finish' ? 1 : pct;
  for (let i = 0; i < 6; i++) { const a = i === 0 ? 0 : th[i - 1]; levelTargets[i] = S.mode === 'finish' ? 1 : clamp01((p3 - a) / (th[i] - a)); }
}

// ---------------- number animation ----------------
let tween = null;
function setTarget(v, instant) {
  S.raisedTarget = v;
  if (instant) { tween = null; S.raisedShown = v; return; }
  tween = { from: S.raisedShown, to: v, t0: performance.now(), dur: Math.min(2200, 700 + Math.abs(v - S.raisedShown) / Math.max(goal(), 1) * 3000) };
}

// ---------------- data wiring ----------------
const ds = new DataSource(P, (st, mode, history) => {
  S.source = mode;
  if (st.car && !P.car && CARS[st.car] && !CARS[st.car].soon && CARS[st.car].id !== S.car.id) setCar(st.car);   // the goal's car, unless ?car= overrides
  if ('goal' in st) S.goal = typeof st.goal === 'number' && st.goal > 0 ? st.goal : null;
  if (typeof st.label === 'string') S.label = st.label;
  if (history) { S.history = history; renderHistory(); }
  if (S.demoPlaying) return;
  S.liveRaised = st.raised;                 // always remember the live value (for "reset")
  if (manualActive()) return;               // dragging overrides polling while active and for ~15 s after
  if (st.raised !== S.raisedTarget) setTarget(st.raised, false);
});

// ---------------- demo ----------------
function playDemo(ms = 5200, from = 0) {
  S.demoPlaying = true; tween = null;
  const g = goal(), t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const step = () => {
    if (!S.demoPlaying) return;               // cancelled (the user took over)
    const t = clamp01((performance.now() - t0) / ms);
    S.raisedShown = S.raisedTarget = S.liveRaised = from + (g - from) * ease(t); $('demoSlider').value = (S.raisedShown / g) * 100;
    if (t < 1) requestAnimationFrame(step); else S.demoPlaying = false;
  };
  step();
}
function setupDemoPanel() {
  const panel = $('demo'); panel.hidden = false; $('demoMode').textContent = '· ' + S.source;
  $('demoSlider').oninput = (e) => { S.demoPlaying = false; setTarget((e.target.value / 100) * goal(), true); };
  panel.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => { S.demoPlaying = false; setTarget(Math.min(goal(), S.raisedTarget + Number(b.dataset.add)), false); $('demoSlider').value = (S.raisedTarget / goal()) * 100; }));
  $('demoPlay').onclick = () => playDemo();
  $('demoClear').onclick = () => { S.demoPlaying = false; setTarget(0, true); $('demoSlider').value = 0; };
}
addEventListener('keydown', (e) => { if (e.key === 'd' && !e.metaKey && !e.ctrlKey) { const p = $('demo'); if (p.hidden) setupDemoPanel(); else p.hidden = true; } });

// ---------------- controls ----------------
$('pill').querySelectorAll('button').forEach((b) => (b.onclick = () => {
  S.mode = b.dataset.mode; $('pill').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); renderUI();
}));
$('reset').onclick = () => {
  camera.position.copy(HOME.pos); controls.target.copy(HOME.target); controls.autoRotate = true;
  for (let i = 0; i < 6; i++) levels[i] = 0;
  nudge.cur = { tx: HOME.target.x, ty: HOME.target.y, tz: HOME.target.z, z: 1 };
};

// ---------------- manual override: drag the amount / scrub the bar ----------------
// Dragging never POSTs anywhere. It pauses live updates while active and for MANUAL_HOLD_MS after (API mode);
// the "manual — reset" chip jumps back to the live value. With no API there is nothing to override, so it stays.
const MANUAL_HOLD_MS = 15000;
const DRAGGABLE = !P.embed || P.drag;
const manualActive = () => S.dragging || performance.now() < S.manualUntil;
function setManual(on) {
  S.manual = on; $('manual').hidden = !on || !DRAGGABLE;
  document.body.classList.toggle('is-manual', on);
}
function checkManualExpiry(now) {
  if (S.manual && !S.dragging && now >= S.manualUntil) { setManual(false); if (S.liveRaised !== S.raisedTarget) setTarget(S.liveRaised, false); }
}
function resetManual() {
  S.manualUntil = 0; S.dragging = false; setManual(false); setTarget(S.liveRaised, false);
}
// set the value directly (no tween) — used while dragging so everything follows at frame rate
function setManualValue(v) {
  const g = goal(); v = Math.min(g, Math.max(0, v));
  S.demoPlaying = false; tween = null; S.raisedTarget = S.raisedShown = v;
  const sl = $('demoSlider'); if (sl) sl.value = (v / g) * 100;
}
function snapStep() { // a "nice" step ≈ 1% of the goal (1k for $164.5k)
  const raw = goal() / 100, p10 = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1)))), m = raw / p10;
  return p10 * (m >= 5 ? 5 : m >= 2 ? 2 : 1);
}
function beginManual() { S.dragging = true; S.demoPlaying = false; tween = null; setManual(true); document.body.classList.add('dragging'); }
function endManual() {
  S.dragging = false; document.body.classList.remove('dragging');
  S.manualUntil = performance.now() + (ds.mode === 'api' ? MANUAL_HOLD_MS : Infinity);
}
const PX_FULL = () => Math.min(620, Math.max(360, innerWidth * 0.34)); // pixels of drag for 0 → 100%

function setupDrag() {
  const num = $('amount'), hit = $('barHit'), bar = hit.querySelector('.bar');
  if (!DRAGGABLE) { num.removeAttribute('tabindex'); num.removeAttribute('role'); hit.removeAttribute('tabindex'); hit.removeAttribute('role'); document.body.classList.add('no-drag'); return; }
  $('manual').onclick = resetManual;
  // the big number: grab it, drag horizontally (→ up) or vertically (↑ up); Shift snaps, Alt = fine
  let st = null;
  num.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    num.setPointerCapture(e.pointerId); beginManual();
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, v: S.raisedShown, fine: e.altKey };
    e.preventDefault();
  });
  num.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    if (e.altKey !== st.fine) { st.v = S.raisedShown; st.x = e.clientX; st.y = e.clientY; st.fine = e.altKey; } // re-anchor when toggling fine mode
    const d = (e.clientX - st.x) + (st.y - e.clientY);
    let v = st.v + (d / PX_FULL()) * goal() * (e.altKey ? 0.1 : 1);
    if (e.shiftKey) { const q = snapStep(); v = Math.round(v / q) * q; }
    setManualValue(v);
  });
  const up = (e) => { if (st && e.pointerId === st.id) { st = null; endManual(); } };
  num.addEventListener('pointerup', up); num.addEventListener('pointercancel', up);
  num.addEventListener('lostpointercapture', up);
  // the bar: click / drag anywhere along it
  let sb = null;
  const fromX = (e, snap) => { const r = bar.getBoundingClientRect(); let v = ((e.clientX - r.left) / r.width) * goal(); if (snap) { const q = snapStep(); v = Math.round(v / q) * q; } setManualValue(v); };
  hit.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button > 0) return;
    hit.setPointerCapture(e.pointerId); beginManual(); sb = e.pointerId; fromX(e, e.shiftKey); e.preventDefault();
  });
  hit.addEventListener('pointermove', (e) => { if (sb === e.pointerId) fromX(e, e.shiftKey); });
  const upb = (e) => { if (sb === e.pointerId) { sb = null; endManual(); } };
  hit.addEventListener('pointerup', upb); hit.addEventListener('pointercancel', upb); hit.addEventListener('lostpointercapture', upb);
  // keyboard on either focused control
  const keys = (e) => {
    const q = snapStep(), small = q / 10, big = e.shiftKey ? q * 10 : q;
    let v = S.raisedShown, hitKey = true;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowUp': v += e.shiftKey ? q : small; break;
      case 'ArrowLeft': case 'ArrowDown': v -= e.shiftKey ? q : small; break;
      case 'PageUp': v += big * 5; break;
      case 'PageDown': v -= big * 5; break;
      case 'Home': v = 0; break;
      case 'End': v = goal(); break;
      default: hitKey = false;
    }
    if (!hitKey) return;
    e.preventDefault();
    S.demoPlaying = false; tween = null; setManual(true); setManualValue(v);
    S.manualUntil = performance.now() + (ds.mode === 'api' ? MANUAL_HOLD_MS : Infinity);
  };
  num.addEventListener('keydown', keys); hit.addEventListener('keydown', keys);
}
setupDrag();
if (DRAGGABLE) { setTimeout(() => document.querySelector('.amount-wrap').classList.add('intro'), 1800); setTimeout(() => document.querySelector('.amount-wrap').classList.remove('intro'), 5200); }

// ---------------- camera nudge per stage (focus the wheels at stage 2, the cabin at 3 ...) ----------------
// A smooth function of the continuous stage position; applied as a delta so the user's own orbit / zoom is kept.
const nudge = { cur: { tx: HOME.target.x, ty: HOME.target.y, tz: HOME.target.z, z: 1 } };
const NUDGE_KEYS = [
  { tx: -0.2, ty: 0.25, tz: 0, z: 0.9 },   // 1 foundation — low, on the chassis
  { tx: 0.05, ty: 0.32, tz: 0, z: 0.84 },  // 2 wheels
  { tx: -0.1, ty: 0.72, tz: 0, z: 0.84 },  // 3 cabin
  { tx: 0, ty: 0.58, tz: 0, z: 0.98 },     // 4 bodywork — pull back to see the panels land
  { tx: 0.3, ty: 0.82, tz: 0, z: 0.88 },   // 5 glazing
  { tx: 0, ty: 0.5, tz: 0, z: 1 },         // 6 finishing / complete
];
function nudgeTarget() {
  const ps = levels[0] + levels[1] + levels[2] + levels[3] + levels[4] + levels[5];  // 0..6
  const f = Math.min(5, Math.max(0, ps - 0.5)), i = Math.min(4, Math.floor(f)), t = f - i, e = t * t * (3 - 2 * t);
  const a = NUDGE_KEYS[i], b = NUDGE_KEYS[i + 1], m = (k) => a[k] + (b[k] - a[k]) * e;
  const narrow = Math.min(1, Math.max(0, (camera.aspect - 0.9) / 0.9));   // on tall/narrow screens keep the whole car in frame
  return { tx: m('tx'), ty: m('ty'), tz: m('tz'), z: 1 - (1 - m('z')) * narrow };
}
function nudgeCamera(dt) {
  const goalN = nudgeTarget(), c = nudge.cur, k = 1 - Math.exp(-dt * 5);
  const n = { tx: c.tx + (goalN.tx - c.tx) * k, ty: c.ty + (goalN.ty - c.ty) * k, tz: c.tz + (goalN.tz - c.tz) * k, z: c.z + (goalN.z - c.z) * k };
  controls.target.x += n.tx - c.tx; controls.target.y += n.ty - c.ty; controls.target.z += n.tz - c.tz;
  const r = n.z / c.z;
  if (Math.abs(r - 1) > 1e-6) { const off = camera.position.clone().sub(controls.target).multiplyScalar(r); camera.position.copy(controls.target).add(off); }
  nudge.cur = n;
}

// ---------------- loop ----------------
let last = performance.now();
const LP = { auto: P.lowpower === null, ema: 16, slowSince: 0, readyAt: 0 };
let skipped = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || !S.onscreen) { last = now; skipped++; return; }   // tab hidden / iframe scrolled out of view: no rendering
  const rawMs = now - last;
  const dt = Math.min(0.1, rawMs / 1000); last = now;
  if (quietUntilSettled && !tween && !S.demoPlaying) { quietUntilSettled = false; toastQuiet = false; }
  // automatic low-power: frame time above 25 ms for 3 s straight (once the model is up; shader compiles are ignored)
  if (LP.auto && !S.lowPower && carObj && carObj.userData.state !== 'loading') {
    if (!LP.readyAt) LP.readyAt = now;
    if (now - LP.readyAt > 2000 && rawMs < 3000) {      // (multi-second gaps = the tab was throttled, not a slow GPU)
      LP.ema = LP.ema * 0.85 + Math.min(rawMs, 250) * 0.15;
      if (LP.ema > 25) { if (!LP.slowSince) LP.slowSince = now; else if (now - LP.slowSince > 3000) setLowPower(true, 'auto: frame time ' + LP.ema.toFixed(0) + ' ms'); }
      else LP.slowSince = 0;
    }
  }
  if (tween) {
    const t = clamp01((now - tween.t0) / tween.dur), e = 1 - Math.pow(1 - t, 3);
    S.raisedShown = tween.from + (tween.to - tween.from) * e; if (t >= 1) tween = null;
  }
  checkManualExpiry(now);
  renderUI();
  // light smoothing only: every part's pose is a pure function of these levels (see gltfcar.js), so the build
  // can be scrubbed both ways; the smoothing just takes the edge off jumps. Near-instant while dragging.
  const k = 1 - Math.exp(-dt * (S.dragging ? 45 : 9));
  for (let i = 0; i < 6; i++) levels[i] += (levelTargets[i] - levels[i]) * k;
  if (carObj) carObj.userData.setProgress(levels.map((v, i) => (Math.abs(v - levelTargets[i]) < 0.0005 ? levelTargets[i] : v)));
  nudgeCamera(dt);
  wheelShadows.children.forEach((m) => { m.material.opacity = Math.min(1, levels[1] * 2); }); // tyre shadows appear with the wheels
  controls.update();
  renderer.render(scene, camera);
  if (!window.__ready && now > 600 && carLoaded) window.__ready = true;
}

// ---------------- low-power mode ----------------
// ?lowpower=1 forces it, ?lowpower=0 disables the automatic switch. Low-power = no floor reflection, no sparks, pixel ratio 1.
function setLowPower(on, why) {
  S.lowPower = on; S.lowPowerWhy = why || '';
  renderer.setPixelRatio(on ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  resize();
  if (carObj && carObj.userData.setLowPower) carObj.userData.setLowPower(on);
  document.body.classList.toggle('lowpower', on);
  const chip = $('lp'); if (chip) { chip.hidden = !on; chip.title = why || ''; }
  if (on) console.info('[car-tracker] low-power mode:', why);
}
if (P.lowpower === true) setLowPower(true, '?lowpower=1');
else if (P.lowpower === null && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820) setLowPower(true, 'auto: mobile');
// pause rendering when the stage is scrolled out of view (e.g. an embed further down your dashboard)
if ('IntersectionObserver' in window) new IntersectionObserver((es) => { S.onscreen = es[es.length - 1].isIntersecting; }, { threshold: 0 }).observe($('stage'));

// ---------------- embed builder ----------------
function setupEmbedBuilder() {
  const btn = $('embedBtn'), panel = $('embedPanel'); if (!btn || P.embed) return;
  const gSel = $('ebGoal'), cSel = $('ebCar');
  const base = location.origin + location.pathname.replace(/index\.html$/, '');
  cSel.innerHTML = '<option value="">Goal\'s car</option>';
  Object.values(CARS).filter((c) => !c.hidden && !c.soon).forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; cSel.appendChild(o); });
  const fillGoals = (list) => {
    gSel.innerHTML = '';
    const ids = list.length ? [...list] : [{ id: 'default', label: 'Some revenue' }];
    if (!ids.some((g) => g.id === P.goalId)) ids.push({ id: P.goalId, label: S.label || '' });
    ids.forEach((g) => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.id + (g.label ? ' — ' + g.label : ''); gSel.appendChild(o); });
    const o = document.createElement('option'); o.value = '__new'; o.textContent = 'New goal id…'; gSel.appendChild(o);
    gSel.value = ids.some((g) => g.id === P.goalId) ? P.goalId : ids[0].id;
    update();
  };
  const url = () => {
    const q = new URLSearchParams();
    const gid = gSel.value === '__new' ? ($('ebGoalNew').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'default') : gSel.value;
    if (gid && gid !== 'default') q.set('goal', gid);
    if (cSel.value) q.set('car', cSel.value);
    q.set('embed', '1');
    if ($('ebDrag').checked) q.set('drag', '1');
    if ($('ebHeader').checked) q.set('header', '1');
    if (!$('ebChart').checked) q.set('chart', '0');
    return base + '?' + q.toString().replace(/%2F/g, '/');
  };
  function update() {
    $('ebGoalNew').hidden = gSel.value !== '__new';
    const u = url(), h = Math.max(320, Math.min(1400, +$('ebHeight').value || 640));
    $('ebUrl').value = u; $('ebOpen').href = u;
    $('ebCode').value = `<iframe src="${u}"\n  title="Revenue tracker" style="width:100%;height:${h}px;border:0;border-radius:16px;background:#111" loading="lazy"></iframe>`;
  }
  panel.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', update));
  const copy = (id, b) => async () => {
    const v = $(id).value; let ok = false;
    try { await navigator.clipboard.writeText(v); ok = true; } catch (e) { $(id).select(); ok = document.execCommand && document.execCommand('copy'); }
    b.textContent = ok ? 'Copied ✓' : 'Select + ⌘C'; setTimeout(() => (b.textContent = b.dataset.label), 1600);
  };
  panel.querySelectorAll('[data-copy]').forEach((b) => { b.dataset.label = b.textContent; b.onclick = copy(b.dataset.copy, b); });
  const open = (on) => { panel.hidden = !on; btn.setAttribute('aria-expanded', on); if (on) { fetch('./data/index.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { goals: [] })).then((j) => fillGoals(j.goals || [])).catch(() => fillGoals([])); } };
  btn.onclick = () => open(panel.hidden);
  $('ebClose').onclick = () => open(false);
  panel.addEventListener('pointerdown', (e) => { if (e.target === panel) open(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) open(false); });
  fillGoals([]);
}
setupEmbedBuilder();

// ---------------- boot ----------------
applyCarText(); buildStageList(); buildSelector(); resize();
if (P.demo) setupDemoPanel();
$('loading').classList.add('show');
// lazy-load: wait for the goal's data first (it may pick a different car), so only ONE model is ever downloaded
const started = ds.start();
Promise.race([started, new Promise((r) => setTimeout(r, P.car ? 0 : 5000))]).then(() => { if (!carLoaded) loadCar(); });
started.then(() => {
  if (!carLoaded) loadCar();
  if (ds.mode === 'param') setTarget(P.raised, false);
  if (ds.mode === 'demo') toastQuiet = false; else quietUntilSettled = true;
  if (ds.mode === 'demo' && !P.demo) setTimeout(() => playDemo(6500), 900);
  if (P.demo) $('demoMode').textContent = '· ' + ds.mode;
  window.__source = ds.mode;
});
requestAnimationFrame(frame);
// test hooks
Object.defineProperty(window, '__car', { get: () => carObj });
window.__ct = { settle: () => { renderUI(true); levels.forEach((_, i) => (levels[i] = levelTargets[i])); }, drag: setManualValue, toast, setLowPower, get skipped() { return skipped; }, get lowPower() { return S.lowPower; }, lp: LP, beginManual, endManual, resetManual, scene, floor, shadow, wheelShadows, pool, ring, camera, renderer, setRaised: (v) => { S.demoPlaying = false; setTarget(v, true); }, state: S, levels };
