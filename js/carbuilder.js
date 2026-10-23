// Procedural 911-style coupe built from three.js primitives / lofted surfaces.
// No third-party model: everything is generated here. Coordinates: +x = front, +y = up, z = width.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- helpers ----------
// monotone cubic interpolation (no overshoot)
function curve(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const n = xs.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);

// ---------- body profiles (side/plan outline, in metres) ----------
const U = curve([[-2.26, 0.72], [-2.2, 0.8], [-1.95, 0.91], [-1.5, 1.05], [-1.0, 1.2], [-0.45, 1.295], [-0.1, 1.3], [0.2, 1.25], [0.5, 1.1], [0.8, 0.96], [1.1, 0.89], [1.6, 0.82], [2.0, 0.72], [2.2, 0.63], [2.27, 0.54]]);
const S = curve([[-2.3, 0.98], [-1.0, 0.99], [-0.2, 0.95], [0.8, 0.91], [2.3, 0.91]]);  // belt line
const B = curve([[-2.27, 0.34], [-2.15, 0.22], [-1.5, 0.15], [1.0, 0.15], [1.85, 0.17], [2.17, 0.23], [2.27, 0.36]]);
const W = curve([[-2.27, 0.08], [-2.245, 0.4], [-2.15, 0.66], [-1.85, 0.85], [-1.3, 0.935], [-0.6, 0.94], [0.0, 0.89], [0.6, 0.86], [1.2, 0.885], [1.7, 0.84], [2.05, 0.71], [2.22, 0.46], [2.27, 0.08]]);
const X0 = -2.27, X1 = 2.27;
const Tb = (x) => Math.min(U(x), S(x));

const WHEELS = [ // x, z
  { x: 1.4, z: 0.76, front: true }, { x: 1.4, z: -0.76, front: true },
  { x: -0.95, z: 0.76 }, { x: -0.95, z: -0.76 },
];
const WHEEL_R = 0.345;

// height of the paint surface at (x, z)
function bodyTop(x, z) {
  const b = B(x), t = Tb(x), w = W(x);
  const cy = (b + t) / 2, hh = (t - b) / 2;
  const r = Math.min(Math.abs(z) / w, 0.9999);
  return cy + hh * Math.pow(1 - Math.pow(r, 2.75), 1 / 2.75);
}

// ---------- lofting ----------
function loftGeometry(stations, ring, N, caps = true) {
  const pos = [], idx = [];
  stations.forEach((x) => {
    const r = ring(x);
    for (let k = 0; k < N; k++) {
      const th = (k / N) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const n = s >= 0 ? r.nTop : r.nBot, hh = s >= 0 ? r.hTop : r.hBot;
      pos.push(x, r.cy + hh * spow(s, 2 / n), spow(c, 2 / n) * r.w);
    }
  });
  const M = stations.length;
  for (let i = 0; i < M - 1; i++) for (let k = 0; k < N; k++) {
    const a = i * N + k, b = i * N + ((k + 1) % N), c = (i + 1) * N + k, d = (i + 1) * N + ((k + 1) % N);
    idx.push(a, c, b, b, c, d);
  }
  if (caps) {
    for (const [i, flip] of [[0, true], [M - 1, false]]) {
      let cx = 0, cy = 0;
      for (let k = 0; k < N; k++) { cx += pos[(i * N + k) * 3 + 1]; }
      cy = cx / N;
      const ci = pos.length / 3; pos.push(pos[i * N * 3], cy, 0);
      for (let k = 0; k < N; k++) { const a = i * N + k, b = i * N + ((k + 1) % N); flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.userData = { N, M };
  return g;
}

// carve wheel arches by lifting the lower side vertices up to an arch contour
function carveArches(g, R) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = Math.abs(p.getZ(i));
    const s = sstep(0.42, 0.7, z);
    if (s <= 0) continue;
    for (const w of WHEELS) {
      if (w.z < 0) continue;
      const dx = x - w.x, a = w.front ? 0.0 : 0.0;
      const Ra = R + (w.front ? 0.045 : 0.065);
      if (Math.abs(dx) >= Ra) continue;
      const contour = 0.345 + Math.sqrt(Ra * Ra - dx * dx) * 1.02;
      if (y < contour) p.setY(i, y + (contour - y) * s);
    }
  }
  p.needsUpdate = true;
}

function smooth(g) { g.computeVertexNormals(); return g; }

function ringBody(shape) {
  return (x) => {
    const b = B(x), t = Tb(x), w = W(x);
    const cy = (b + t) / 2, hh = (t - b) / 2;
    return { cy, hTop: hh, hBot: hh, w, nTop: 2.75, nBot: 3.8 };
  };
}
function ringGlass(x) {
  const base = Tb(x) - 0.09, top = U(x), w = W(x) * 0.86;
  const tk = Math.max(0.0, top - base);
  // narrow the roof via exponent; lower half is a flat sliver (buried in body)
  return { cy: base, hTop: tk, hBot: 0.02, w: w * (0.78 + 0.22 * sstep(0.03, 0.22, top - Tb(x))), nTop: 3.3, nBot: 6 };
}

function stationsFor(x0, x1, M) {
  const a = [];
  for (let i = 0; i <= M; i++) a.push(x0 + (x1 - x0) * (1 - Math.cos((Math.PI * i) / M)) / 2);
  return a;
}

// ---------- the builder ----------
export function buildCoupe(cfg, renderer) {
  const sc = (cfg.shape && cfg.shape.scale) || [1, 1, 1];
  const root = new THREE.Group();
  const car = new THREE.Group();
  car.scale.set(sc[0], sc[1], sc[2]);
  root.add(car);

  const stageGroups = Array.from({ length: 6 }, () => { const g = new THREE.Group(); car.add(g); return g; });
  const track = Array.from({ length: 6 }, () => []); // [{mat, base}]
  const reg = (stage, mat, base = 1) => { track[stage].push({ mat, base }); return mat; };
  const add = (stage, mesh) => { stageGroups[stage].add(mesh); return mesh; };

  const paintCol = new THREE.Color(cfg.color);
  const paint = reg(3, new THREE.MeshPhysicalMaterial({ color: paintCol, metalness: 0.95, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.75 }));
  const steel = (c = '#2a2e35', st = 0, rough = 0.5) => reg(st, new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: rough }));
  const addEdges = (mesh, stage, op = 0.5) => {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), reg(stage, new THREE.LineBasicMaterial({ color: 0xc4d300, transparent: true, opacity: op }), op));
    mesh.add(e); return e;
  };

  // ===== body =====
  const stations = stationsFor(X0, X1, 190);
  const bodyGeo = smooth(loftGeometry(stations, ringBody(), 112));
  carveArches(bodyGeo, WHEEL_R);
  bodyGeo.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeo, paint); paint.side = THREE.FrontSide;
  add(3, body);

  // x-ray shell
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9db4c8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide });
  const ghost = new THREE.Mesh(bodyGeo, ghostMat); ghost.renderOrder = 3;
  const ghostLineMat = new THREE.LineBasicMaterial({ color: 0xc4d300, transparent: true, opacity: 0.28, depthWrite: false });
  const ghostLines = new THREE.Group();
  {
    const N = 112, p = bodyGeo.attributes.position;
    for (let i = 8; i < stations.length - 4; i += 9) {
      const pts = []; for (let k = 0; k <= N; k++) pts.push(new THREE.Vector3().fromBufferAttribute(p, i * N + (k % N)));
      ghostLines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ghostLineMat));
    }
    // side silhouette lines
    for (const kk of [N / 4, 0, N / 2, (3 * N) / 4]) {
      const pts = []; for (let i = 0; i < stations.length; i++) pts.push(new THREE.Vector3().fromBufferAttribute(p, i * N + kk));
      ghostLines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ghostLineMat));
    }
  }
  car.add(ghost, ghostLines);

  // ===== glass (greenhouse) =====
  const gx0 = -1.62, gx1 = 0.86;
  const glassGeo = smooth(loftGeometry(stationsFor(gx0, gx1, 90), ringGlass, 72));
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x020304, metalness: 0.0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.0, transparent: true, opacity: 0, polygonOffsetFactor: 0 });
  const glass = new THREE.Mesh(glassGeo, glassMat); glass.renderOrder = 5;
  car.add(glass);

  // pillars / roof (paint patches over the glass loft)
  const ringPatch = (x0, x1, th0, th1, inflate, Nseg = 24, Mseg = 20) => {
    const pos = [], idx = [];
    const xs = stationsFor(x0, x1, Mseg);
    xs.forEach((x) => {
      const r = ringGlass(x);
      for (let k = 0; k <= Nseg; k++) {
        const th = th0 + ((th1 - th0) * k) / Nseg, c = Math.cos(th), s = Math.sin(th);
        const n = s >= 0 ? r.nTop : r.nBot, hh = s >= 0 ? r.hTop : r.hBot;
        const y = r.cy + hh * spow(s, 2 / n), z = spow(c, 2 / n) * r.w;
        // inflate along approx normal (ring-space)
        const nx = spow(c, 2 - 2 / n) / r.w, ny = spow(s, 2 - 2 / n) / hh;
        const l = Math.hypot(nx, ny) || 1;
        pos.push(x, y + (ny / l) * inflate, z + (nx / l) * inflate);
      }
    });
    for (let i = 0; i < Mseg; i++) for (let k = 0; k < Nseg; k++) {
      const a = i * (Nseg + 1) + k, b = a + 1, c = a + Nseg + 1, d = c + 1; idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  const PI = Math.PI;
  const mats = new THREE.Group();
  const patchMat = paint; patchMat.side = THREE.DoubleSide;
  // roof panel (top arc)
  add(3, new THREE.Mesh(ringPatch(-1.5, 0.28, PI / 2 - 0.5, PI / 2 + 0.5, 0.012, 20, 70), patchMat));
  // A pillars (both sides)
  for (const sgn of [1, -1]) {
    const a0 = sgn > 0 ? PI / 2 - 0.72 : PI / 2 + 0.5, a1 = sgn > 0 ? PI / 2 - 0.5 : PI / 2 + 0.72;
    add(3, new THREE.Mesh(ringPatch(0.22, 0.84, a0, a1, 0.012, 6, 20), patchMat));
  }
  // B pillar hoop and C pillars
  add(3, new THREE.Mesh(ringPatch(-0.5, -0.42, -0.15, PI + 0.15, 0.012, 30, 3), patchMat));
  for (const sgn of [1, -1]) {
    const a0 = sgn > 0 ? 0.05 : PI - 0.5, a1 = sgn > 0 ? 0.5 : PI - 0.05;
    add(3, new THREE.Mesh(ringPatch(-1.6, -1.1, a0 + (sgn > 0 ? -0.0 : 0), a1, 0.012, 8, 20), patchMat));
  }

  // door shut lines & sills
  const lineMat = reg(3, new THREE.MeshBasicMaterial({ color: 0x0a0b0d }));
  for (const sgn of [1, -1]) {
    // door cut: front edge
    for (const dx of [0.62, -0.46]) {
      const h = 0.34;
      const y0 = 0.4, y1 = 0.8;
      const z = bodyZAt(dx, 0.68) ;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.008, y1 - y0, 0.006), lineMat);
      m.position.set(dx, (y0 + y1) / 2, sgn * (z + 0.0));
      add(3, m);
    }
  }
  function bodyZAt(x, yRel) { // half-width of body surface at the lower belt (approx)
    const b = B(x), t = Tb(x), w = W(x), cy = (b + t) / 2, hh = (t - b) / 2;
    const y = Math.min(0.7, t - 0.05);
    const v = Math.min(0.999, Math.abs((y - cy) / hh));
    const n = y >= cy ? 2.75 : 3.8;
    return w * Math.pow(1 - Math.pow(v, n), 1 / n);
  }

  // mirrors, rear lip spoiler, side skirts, front splitter, bumper vents
  for (const sgn of [1, -1]) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.09, 0.12, 3, 0.04), patchMat);
    m.position.set(0.64, 1.0, sgn * 0.84); m.rotation.y = sgn * 0.0; add(3, m);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.2), paint); stalk.position.set(0.68, 0.96, sgn * 0.74); add(3, stalk);
  }
  const lip = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.035, 1.2, 2, 0.015), paint);
  lip.position.set(-2.18, 0.855, 0); lip.rotation.z = 0.12; add(3, lip);
  const blackTrim = reg(3, new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.55, metalness: 0.1 }));
  for (const sgn of [1, -1]) {
    const sk = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.05, 0.05, 2, 0.02), blackTrim);
    sk.position.set(0.12, 0.2, sgn * 0.86); add(3, sk);
  }
  // front bumper air intakes (dark)
  for (const sgn of [1, -1]) {
    const v = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.1, 0.34, 2, 0.02), blackTrim);
    v.position.set(2.11, 0.33, sgn * 0.42); v.rotation.y = -sgn * 0.35; add(3, v);
  }
  const centreIntake = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.1, 0.5, 2, 0.02), blackTrim);
  centreIntake.position.set(2.2, 0.34, 0); add(3, centreIntake);
  // fuel/hood line
  const hoodLine = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.005, 1.0), lineMat);

  // ===== stage 0: foundation (chassis + engine) =====
  const chas = steel('#262b32', 0, 0.6);
  const pan = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.035, 1.28), chas); pan.position.set(0, 0.21, 0); add(0, pan); addEdges(pan, 0, 0.5);
  for (const sgn of [1, -1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.1, 0.07), chas); rail.position.set(0, 0.27, sgn * 0.45); add(0, rail); addEdges(rail, 0, 0.55);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.08), chas); sill.position.set(0.1, 0.27, sgn * 0.7); add(0, sill); addEdges(sill, 0, 0.45);
  }
  for (const x of [-1.9, -1.3, -0.5, 0.3, 1.0, 1.7]) {
    const cm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.3), chas); cm.position.set(x, 0.27, 0); add(0, cm); addEdges(cm, 0, 0.45);
  }
  // flat-six engine (rear)
  const engMetal = steel('#4a5059', 0, 0.35), engDark = steel('#1d2025', 0, 0.5), engSilver = steel('#9aa1ab', 0, 0.3);
  const crank = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.24, 0.36, 3, 0.04), engDark); crank.position.set(-1.55, 0.38, 0); add(0, crank); addEdges(crank, 0, 0.5);
  for (const sgn of [1, -1]) for (let i = 0; i < 3; i++) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.3, 24), engMetal);
    cyl.rotation.x = Math.PI / 2; cyl.position.set(-1.8 + i * 0.25, 0.38, sgn * 0.3); add(0, cyl);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 24), engSilver);
    cap.rotation.x = Math.PI / 2; cap.position.set(-1.8 + i * 0.25, 0.38, sgn * 0.46); add(0, cap);
  }
  const intake = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.1, 0.32, 3, 0.04), engSilver); intake.position.set(-1.55, 0.58, 0); add(0, intake);
  for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 12), engSilver); t.position.set(-1.8 + i * 0.1, 0.5, (i % 2 ? 0.1 : -0.1)); add(0, t); }
  // transmission, driveshaft, diff
  const trans = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.26, 0.36, 3, 0.06), engMetal); trans.position.set(-0.95, 0.34, 0); add(0, trans); addEdges(trans, 0, 0.5);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 14), engSilver); shaft.rotation.z = Math.PI / 2; shaft.position.set(0.15, 0.3, 0); add(0, shaft);
  const diff = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.2, 0.34, 3, 0.05), engMetal); diff.position.set(1.4, 0.31, 0); add(0, diff);
  // exhaust
  const exMat = steel('#8e949c', 0, 0.28);
  for (const sgn of [1, -1]) {
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.75, 0.3, sgn * 0.22), new THREE.Vector3(-1.9, 0.24, sgn * 0.32), new THREE.Vector3(-2.05, 0.3, sgn * 0.4)]);
    const ex = new THREE.Mesh(new THREE.TubeGeometry(path, 12, 0.04, 12), exMat); add(0, ex);
  }
  // fuel tank / front boot
  const tank = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.2, 0.8, 3, 0.06), engDark); tank.position.set(1.85, 0.34, 0); add(0, tank); addEdges(tank, 0, 0.4);
  const axleF = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.52, 12), engMetal); axleF.rotation.x = Math.PI / 2; axleF.position.set(1.4, WHEEL_R, 0); add(0, axleF);
  const axleR = axleF.clone(); axleR.position.x = -0.95; add(0, axleR);

  // ===== stage 1: wheels & brakes =====
  const tyreMat = reg(1, new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.85, metalness: 0.0 }));
  const rimMat = reg(1, new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.22, metalness: 1 }));
  const rimDark = reg(1, new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4, metalness: 0.8 }));
  const discMat = reg(1, new THREE.MeshStandardMaterial({ color: 0x80868e, roughness: 0.35, metalness: 1 }));
  const caliperMat = reg(1, new THREE.MeshPhysicalMaterial({ color: 0xc4d300, roughness: 0.35, metalness: 0.3, clearcoat: 1 }));
  const tyreProfile = [], R = WHEEL_R;
  { // lathe: (radius, axial)
    const half = 0.12;
    const pts = [[0.235, -half + 0.01], [0.27, -half], [0.32, -half * 0.95], [R - 0.005, -half * 0.55], [R, -0.0], [R - 0.005, half * 0.55], [0.32, half * 0.95], [0.27, half], [0.235, half - 0.01], [0.225, half - 0.04], [0.225, -half + 0.04]];
    pts.forEach(([r, a]) => tyreProfile.push(new THREE.Vector2(r, a)));
  }
  const wheelTemplate = (wide) => {
    const g = new THREE.Group();
    const tg = new THREE.LatheGeometry(tyreProfile, 56); tg.scale(1, wide ? 1.1 : 1, 1);
    const tyre = new THREE.Mesh(tg, tyreMat); g.add(tyre);
    const rimLip = new THREE.Mesh(new THREE.TorusGeometry(0.228, 0.014, 10, 56), rimMat); rimLip.rotation.x = Math.PI / 2; rimLip.position.y = 0.105; g.add(rimLip);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.04, 40, 1, false), rimDark); dish.position.y = 0.02; g.add(dish);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 28), rimMat); hub.position.y = 0.075; g.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.075, 20), caliperMat); cap.position.y = 0.09; g.add(cap);
    for (let i = 0; i < 10; i++) { // spokes
      const a = (i / 10) * Math.PI * 2;
      const sp = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.028, 0.04, 2, 0.01), rimMat);
      sp.position.set(Math.cos(a) * 0.14, 0.085, Math.sin(a) * 0.14); sp.rotation.y = -a; sp.rotation.z = 0.0; g.add(sp);
    }
    g.rotation.x = Math.PI / 2; // lathe Y axis -> Z axis
    return g;
  };
  for (const w of WHEELS) {
    const grp = new THREE.Group(); grp.position.set(w.x, WHEEL_R, w.z);
    const wh = wheelTemplate(!w.front); // axis +z: outboard face is +y of lathe -> after rotation.x=PI/2, +y -> +z
    if (w.z < 0) wh.rotation.x = -Math.PI / 2;
    grp.add(wh);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 40), discMat); disc.rotation.x = Math.PI / 2; disc.position.z = -Math.sign(w.z) * 0.035; grp.add(disc);
    const cal = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.12, 0.07, 2, 0.02), caliperMat); cal.position.set(0.1, 0.1, -Math.sign(w.z) * 0.035); grp.add(cal);
    // suspension arm
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 10), steel('#4a5059', 1, 0.4)); arm.rotation.x = Math.PI / 2; arm.position.set(0, 0.0, -Math.sign(w.z) * 0.25);
    grp.add(arm);
    // wheel-well liner
    add(1, grp);
  }
  // ===== stage 2: cabin / interior =====
  const leather = reg(2, new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6, metalness: 0.05 }));
  const leather2 = reg(2, new THREE.MeshStandardMaterial({ color: 0x2d2b29, roughness: 0.55, metalness: 0.05 }));
  const accent = reg(2, new THREE.MeshStandardMaterial({ color: 0xc4d300, roughness: 0.5, metalness: 0.2 }));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.02, 1.15), leather); floor.position.set(-0.15, 0.3, 0); add(2, floor);
  for (const sgn of [1, -1]) {
    const seatBase = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.12, 0.42, 4, 0.05), leather2); seatBase.position.set(-0.55, 0.42, sgn * 0.3); add(2, seatBase);
    const seatBack = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.6, 0.42, 4, 0.05), leather2); seatBack.position.set(-0.8, 0.72, sgn * 0.3); seatBack.rotation.z = 0.18; add(2, seatBack);
    const head = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.2, 0.26, 4, 0.04), leather2); head.position.set(-0.88, 1.1, sgn * 0.3); head.rotation.z = 0.15; add(2, head);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.5, 0.02), accent); stripe.position.set(-0.755, 0.72, sgn * 0.3); stripe.rotation.z = 0.18; add(2, stripe);
    const door = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.36, 0.06, 3, 0.03), leather); door.position.set(-0.05, 0.55, sgn * 0.8); add(2, door);
  }
  const dash = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.2, 1.25, 4, 0.06), leather); dash.position.set(0.52, 0.8, 0); add(2, dash);
  const binnacle = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.17, 0.4, 4, 0.05), leather); binnacle.position.set(0.5, 0.95, 0.3); add(2, binnacle);
  const console_ = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.18, 0.2, 3, 0.05), leather2); console_.position.set(0.0, 0.45, 0); add(2, console_);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.017, 12, 36), leather); sw.position.set(0.32, 0.9, 0.3); sw.rotation.y = Math.PI / 2; sw.rotation.x = 0; sw.rotation.z = 0; sw.rotation.set(0, Math.PI / 2, -0.35); add(2, sw);
  const swc = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), accent); swc.position.copy(sw.position); swc.rotation.z = Math.PI / 2 - 0.35; add(2, swc);
  const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.15, 10), steel('#aaa', 2, 0.3)); gear.position.set(0.1, 0.6, 0); add(2, gear);
  const rearShelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 1.2), leather); rearShelf.position.set(-1.15, 0.52, 0); add(2, rearShelf);

  // ===== stage 5: finishing touches =====
  const lightGlass = reg(5, new THREE.MeshPhysicalMaterial({ color: 0xf2f6f9, roughness: 0.05, metalness: 0.0, clearcoat: 1, transmission: 0, emissive: 0xffffff, emissiveIntensity: 0.0 }));
  const lensMat = reg(5, new THREE.MeshPhysicalMaterial({ color: 0xdfe8f0, roughness: 0.03, metalness: 0, clearcoat: 1, envMapIntensity: 1.4 }), 0.5);
  const chrome = reg(5, new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.12, metalness: 1 }));
  const darkTrim = reg(5, new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 0.35, metalness: 0.2 }));
  const tail = reg(5, new THREE.MeshStandardMaterial({ color: 0x9b0b14, roughness: 0.2, metalness: 0.2, emissive: 0xff1020, emissiveIntensity: 0.0 }));
  for (const sgn of [1, -1]) {
    const hx = 1.86, hz = sgn * 0.58, hy = bodyTop(hx, hz) - 0.005;
    const bez = new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 16), darkTrim); bez.scale.set(1, 0.42, 1); bez.position.set(hx, hy, hz); add(5, bez);
    const refl = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 12), chrome); refl.scale.set(1, 0.6, 1); refl.position.set(hx, hy + 0.02, hz); add(5, refl);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 10), lightGlass); bulb.position.set(hx, hy + 0.05, hz); add(5, bulb);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.12, 28, 16), lensMat); lens.scale.set(1, 0.6, 1); lens.position.set(hx, hy + 0.012, hz); lens.renderOrder = 6; add(5, lens);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.008, 8, 36), chrome); ring.rotation.x = Math.PI / 2; ring.position.set(hx, hy + 0.012, hz); add(5, ring);
    // fog / DRL
    const drl = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.03, 0.2, 2, 0.012), lightGlass); drl.position.set(2.17, 0.4, sgn * 0.5); drl.rotation.y = -sgn * 0.5; add(5, drl);
    // tail light bars
    const tl = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.07, 0.32, 3, 0.025), tail); tl.position.set(-2.19, 0.82, sgn * 0.58); tl.rotation.y = sgn * 0.25; add(5, tl);
    // exhaust tips
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.18, 24, 1, true), chrome); tip.rotation.z = Math.PI / 2; tip.position.set(-2.22, 0.3, sgn * 0.32); tip.material.side = THREE.DoubleSide; add(5, tip);
    // door handles
    const dh = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.025, 0.02, 2, 0.01), chrome); dh.position.set(-0.28, 0.9, sgn * (bodyZAt(-0.28, 0) + 0.01)); add(5, dh);
  }
  const bar = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.03, 0.55, 2, 0.012), tail); bar.position.set(-2.22, 0.82, 0); add(5, bar);
  const grille = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.05, 1.05, 2, 0.02), darkTrim); grille.position.set(-2.2, 0.76, 0); add(5, grille);
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 20), chrome); badge.rotation.z = Math.PI / 2; badge.position.set(2.25, 0.52, 0); add(5, badge);
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.01, 0.12, 0.34, 2, 0.004), chrome); plate.position.set(-2.265, 0.5, 0); add(5, plate);
  const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.5), darkTrim); wiper.position.set(0.82, 1.0, 0.1); wiper.rotation.y = 0.0; add(5, wiper);

  // ===== animate / state API =====
  // levels: array of 6 progress values 0..1 (already smoothed). ghost fade is derived.
  const stageAlpha = (i, p) => (i === 0 ? 0.3 + 0.7 * p : p);
  function setProgress(levels) {
    for (let i = 0; i < 6; i++) {
      const a = stageAlpha(i, levels[i]);
      stageGroups[i].visible = a > 0.004;
      for (const { mat, base } of track[i]) {
        const o = a * base;
        mat.opacity = o; mat.transparent = o < 0.995; mat.depthWrite = o > 0.45;
        if (mat.isLineBasicMaterial) mat.depthWrite = false;
      }
    }
    // glass: black & opaque with the bodywork, turns real glass at stage 4
    const g3 = levels[3], g4 = levels[4];
    glass.visible = g3 > 0.004;
    glassMat.opacity = g3 * (1 - 0.42 * g4);
    glassMat.color.setRGB(0.008 + 0.01 * g4, 0.011 + 0.02 * g4, 0.014 + 0.032 * g4);
    glassMat.envMapIntensity = 0.12 + 1.6 * g4;
    glassMat.depthWrite = g3 > 0.99 && g4 < 0.05;
    // ghost shell
    const gh = 1 - levels[3];
    ghost.visible = ghostLines.visible = gh > 0.004;
    ghostMat.opacity = 0.075 * gh; ghostLineMat.opacity = 0.26 * gh;
    // finishing: gloss + lights
    const f = levels[5];
    paint.roughness = 0.4 - 0.2 * f; paint.clearcoatRoughness = 0.12 - 0.1 * f; paint.envMapIntensity = 0.75 + 0.5 * f;
    lightGlass.emissiveIntensity = 0.0; tail.emissiveIntensity = 0.5 * f;
  }
  setProgress([0, 0, 0, 0, 0, 0]);
  root.userData.setProgress = setProgress;
  root.userData.bodyTop = bodyTop;
  return root;
}
