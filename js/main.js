import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CARS, DEFAULT_CAR, DEFAULT_STAGES, getCar } from './cars.js';
import { buildCoupe } from './carbuilder.js';
import { parseParams, DataSource } from './data.js';

const BUILDERS = { coupe: buildCoupe };
const P = parseParams();
const $ = (id) => document.getElementById(id);
if (P.embed) document.body.classList.add('embed');

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
};
const goal = () => P.goal ?? S.goal ?? S.car.goal;
const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ---------------- three.js scene ----------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const HOME = { pos: new THREE.Vector3(3.35, 1.4, 4.1), target: new THREE.Vector3(0, 0.55, 0) };
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

// lights: key + lime rim
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(4, 7, 5); scene.add(key);
const rim = new THREE.DirectionalLight(0xc4d300, 0.3); rim.position.set(-6, 1.5, -4); scene.add(rim);
const fill = new THREE.DirectionalLight(0x8fb4ff, 0.45); fill.position.set(-4, 2, 6); scene.add(fill);

// ground: soft contact shadow + faint ring
function radialTex(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(0,0,0,.85)'], [0.45, 'rgba(0,0,0,.45)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.scale.set(6.4, 3.2, 1); shadow.position.y = 0.002; scene.add(shadow);
const ring = new THREE.Mesh(new THREE.RingGeometry(3.55, 3.57, 128), new THREE.MeshBasicMaterial({ color: 0xc4d300, transparent: true, opacity: 0.18, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.003; scene.add(ring);

let carObj = null;
const levels = [0, 0, 0, 0, 0, 0];   // smoothed
let levelTargets = [0, 0, 0, 0, 0, 0];
let replay = 0;

function loadCar() {
  if (carObj) { scene.remove(carObj); carObj.traverse((o) => { o.geometry && o.geometry.dispose(); }); }
  const b = typeof S.car.builder === 'function' ? S.car.builder : BUILDERS[S.car.builder] || buildCoupe;
  carObj = b(S.car, renderer);
  scene.add(carObj);
}

function resize() {
  const r = $('stage').getBoundingClientRect();
  const w = Math.max(10, r.width), h = Math.max(10, r.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep the car fully in frame on narrow viewports
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const needH = 6.4 / 2 / Math.tan(vfov / 2) / Math.max(0.5, Math.min(1, camera.aspect * 0.9)) ;
  controls.minDistance = 3.4; controls.maxDistance = 14;
  if (camera.aspect < 1.1) { const d = Math.min(14, needH * 1.0); const dir = camera.position.clone().sub(controls.target).normalize(); if (camera.position.distanceTo(controls.target) < d - 0.01 && !resize.done) camera.position.copy(controls.target).addScaledVector(dir, d); }
  resize.done = true;
  camera.updateProjectionMatrix();
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
  Object.values(CARS).forEach((c) => {
    const b = document.createElement('button'); b.textContent = c.name; b.className = c.id === S.car.id ? 'on' : '';
    b.onclick = () => { const u = new URL(location.href); u.searchParams.set('car', c.id); history.replaceState(null, '', u); P.car = c.id; setCar(c.id); };
    el.appendChild(b);
  });
}
function applyCarText() {
  const c = S.car;
  $('garageNo').textContent = c.garageNo; $('carName').textContent = c.name; $('carColor').textContent = c.colorName; $('carModel').textContent = c.model;
  $('watermark').textContent = c.watermark; $('tagline').textContent = c.tagline;
  document.title = `${c.name} — One sale closer.`;
}
function setCar(id) {
  S.car = getCar(id); applyCarText(); buildStageList(); buildSelector(); loadCar(); levels.fill(0); renderUI(true);
}

let lastKey = '';
function renderUI(force) {
  const g = goal(), shown = S.raisedShown, pct = clamp01(g > 0 ? shown / g : 0);
  const th = S.car.thresholds;
  $('amount').textContent = fmt(shown);
  $('label').textContent = (P.label ?? S.label ?? S.car.label).toUpperCase();
  const pv = pct >= 0.9999 ? 100 : pct * 100 >= 10 ? Math.min(99, Math.round(pct * 100)) : pct === 0 ? 0 : Math.max(0.1, Math.floor(pct * 1000) / 10);
  const pctTxt = pv + '% funded';
  $('pct').textContent = pctTxt; $('of').textContent = 'of ' + fmt(g);
  $('fill').style.width = pct * 100 + '%';
  const togo = $('togo'); const done = pct >= 0.9999;
  togo.textContent = done ? 'You made it.' : fmt(Math.max(0, g - shown)) + ' to the finish line'; togo.classList.toggle('done', done);
  // stages
  const lis = $('stages').children; let completed = 0, activeIdx = -1;
  for (let i = 0; i < 6; i++) { if (pct >= th[i] - 1e-9) completed++; }
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
const ds = new DataSource(P, (st, mode) => {
  S.source = mode;
  if (S.demoPlaying) return;
  if (typeof st.goal === 'number' && st.goal > 0) S.goal = st.goal;
  if (typeof st.label === 'string') S.label = st.label;
  if (st.car && !P.car && CARS[st.car] && CARS[st.car].id !== S.car.id) setCar(st.car);
  if (st.raised !== S.raisedTarget) setTarget(st.raised, false);
});

// ---------------- demo ----------------
function playDemo(ms = 5200, from = 0) {
  S.demoPlaying = true; tween = null;
  const g = goal(), t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const step = () => {
    const t = clamp01((performance.now() - t0) / ms);
    S.raisedShown = S.raisedTarget = from + (g - from) * ease(t); $('demoSlider').value = (S.raisedShown / g) * 100;
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
};

// ---------------- loop ----------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (tween) {
    const t = clamp01((now - tween.t0) / tween.dur), e = 1 - Math.pow(1 - t, 3);
    S.raisedShown = tween.from + (tween.to - tween.from) * e; if (t >= 1) tween = null;
  }
  renderUI();
  const k = 1 - Math.exp(-dt * 3.2);
  for (let i = 0; i < 6; i++) levels[i] += (levelTargets[i] - levels[i]) * k;
  if (carObj) carObj.userData.setProgress(levels.map((v, i) => (Math.abs(v - levelTargets[i]) < 0.002 ? levelTargets[i] : v)));
  controls.update();
  renderer.render(scene, camera);
  if (!window.__ready && now > 600) window.__ready = true;
  requestAnimationFrame(frame);
}

// ---------------- boot ----------------
applyCarText(); buildStageList(); buildSelector(); loadCar(); resize();
if (P.demo) setupDemoPanel();
ds.start().then(() => {
  if (ds.mode === 'param') setTarget(P.raised, P.raised > 0 && false);
  if (ds.mode === 'demo' && !P.demo) setTimeout(() => playDemo(6500), 900);
  if (P.demo) $('demoMode').textContent = '· ' + ds.mode;
  window.__source = ds.mode;
});
requestAnimationFrame(frame);
// test hooks
window.__ct = { setRaised: (v) => { S.demoPlaying = false; setTarget(v, true); }, state: S, levels };
