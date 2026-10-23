// Procedural coupe built from three.js primitives / lofted surfaces. Everything is generated here (no third-party model).
// The silhouette comes from cfg.shape.profile (see js/cars.js). Coordinates: +x = front, +y = up, z = width.
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

// ---------- body shape from a profile ----------
function makeShape(pf) {
  const U = curve(pf.top), S = curve(pf.belt), B = curve(pf.bottom), W = curve(pf.width);
  const Tb = (x) => Math.min(U(x), S(x));
  const w = pf.wheels, WR = w.r;
  const WHEELS = [
    { x: w.fx, z: w.z, front: true }, { x: w.fx, z: -w.z, front: true },
    { x: w.rx, z: w.z }, { x: w.rx, z: -w.z },
  ];
  const hp = pf.humps;
  const win = (x, a, b, c, d) => sstep(a, b, x) * (1 - sstep(c, d, x));
  const g2 = (v, s) => Math.exp(-(v * v) / (s * s));
  // fender humps + hood dip at the front, haunches at the rear (added to the upper surface)
  const bump = (x, z) => {
    const az = Math.abs(z), f = hp.front, r = hp.rear, wf = win(x, f.x0, f.x1, f.x2, f.x3);
    return f.amp * wf * g2(az - f.z, f.sig) - hp.dip * wf * g2(az, 0.3) + r.amp * win(x, r.x0, r.x1, r.x2, r.x3) * g2(az - r.z, r.sig);
  };
  const nTopAt = (x) => 2.75 + (pf.nose.nTop - 2.75) * sstep(1.45, 2.2, x);
  const ringBody = (x) => {
    const b = B(x), t = Tb(x), ww = W(x), cy = (b + t) / 2, hh = (t - b) / 2;
    return { cy, hTop: hh, hBot: hh, w: ww, nTop: nTopAt(x), nBot: 3.8 };
  };
  const ringGlass = (x) => {
    const base = Tb(x) - 0.09, top = U(x), ww = W(x) * 0.86, tk = Math.max(0, top - base);
    return { cy: base, hTop: tk, hBot: 0.02, w: ww * (0.78 + 0.22 * sstep(0.03, 0.22, top - Tb(x))), nTop: 3.3, nBot: 6 };
  };
  // height of the paint surface at (x, z)
  const bodyTop = (x, z) => {
    const b = B(x), t = Tb(x), ww = W(x), cy = (b + t) / 2, hh = (t - b) / 2;
    const r = Math.min(Math.abs(z) / ww, 0.9999), n = nTopAt(x);
    return cy + hh * Math.pow(1 - Math.pow(r, n), 1 / n) + bump(x, z);
  };
  // half-width of the body at height y (approx)
  const bodyZAt = (x, y = 0.7) => {
    const b = B(x), t = Tb(x), ww = W(x), cy = (b + t) / 2, hh = (t - b) / 2;
    const yy = Math.min(y, t - 0.05), v = Math.min(0.999, Math.abs((yy - cy) / hh)), n = yy >= cy ? 2.75 : 3.8;
    return ww * Math.pow(1 - Math.pow(v, n), 1 / n);
  };
  // x of the rear / front surface at height y and lateral z (scan inwards from the tip)
  const inside = (x, y, z) => y > B(x) + 0.005 && y < bodyTop(x, z) && Math.abs(z) < bodyZAt(x, y);
  const rearX = (y, z) => { for (let x = pf.x0; x < pf.x0 + 1; x += 0.004) if (inside(x, y, z)) return x; return pf.x0; };
  const frontX = (y, z) => { for (let x = pf.x1; x > pf.x1 - 1; x -= 0.004) if (inside(x, y, z)) return x; return pf.x1; };
  return { rearX, frontX, U, S, B, W, Tb, WR, WHEELS, bump, ringBody, ringGlass, bodyTop, bodyZAt, X0: pf.x0, X1: pf.x1 };
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
      let cx = 0;
      for (let k = 0; k < N; k++) cx += pos[(i * N + k) * 3 + 1];
      const cy = cx / N, ci = pos.length / 3; pos.push(pos[i * N * 3], cy, 0);
      for (let k = 0; k < N; k++) { const a = i * N + k, b = i * N + ((k + 1) % N); flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// fender humps / haunches: lift the upper surface
function applyBumps(g, sh) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const cy = (sh.B(x) + sh.Tb(x)) / 2, hh = (sh.Tb(x) - sh.B(x)) / 2;
    if (y <= cy) continue;
    p.setY(i, y + sh.bump(x, z) * sstep(cy, cy + hh * 0.7, y));
  }
  p.needsUpdate = true;
}

// carve wheel arches by lifting the lower side vertices up to an arch contour
function carveArches(g, sh) {
  const p = g.attributes.position, R = sh.WR;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = Math.abs(p.getZ(i));
    const s = sstep(0.42, 0.7, z);
    if (s <= 0) continue;
    for (const w of sh.WHEELS) {
      if (w.z < 0) continue;
      const dx = x - w.x, Ra = R + (w.front ? 0.045 : 0.06);
      if (Math.abs(dx) >= Ra) continue;
      const contour = R + Math.sqrt(Ra * Ra - dx * dx) * 1.02;
      if (y < contour) p.setY(i, y + (contour - y) * s);
    }
  }
  p.needsUpdate = true;
}

function stationsFor(x0, x1, M) {
  const a = [];
  for (let i = 0; i <= M; i++) a.push(x0 + (x1 - x0) * (1 - Math.cos((Math.PI * i) / M)) / 2);
  return a;
}

// ---------- the builder ----------
export function buildCoupe(cfg, renderer) {
  const sc = (cfg.shape && cfg.shape.scale) || [1, 1, 1];
  const pf = cfg.shape.profile;
  const sh = makeShape(pf);
  const { U, S, Tb, WR, WHEELS, bodyTop, bodyZAt, X0, X1, rearX, frontX } = sh;
  const GL = pf.glass, LY = pf.layout, LT = pf.lights;
  const root = new THREE.Group();
  const car = new THREE.Group();
  car.scale.set(sc[0], sc[1], sc[2]);
  root.add(car);

  const stageGroups = Array.from({ length: 6 }, () => { const g = new THREE.Group(); car.add(g); return g; });
  const track = Array.from({ length: 6 }, () => []); // [{mat, base}]
  const reg = (stage, mat, base = 1) => { track[stage].push({ mat, base }); return mat; };
  const add = (stage, mesh) => { stageGroups[stage].add(mesh); return mesh; };
  // engine / cabin live in offset sub-groups so mid-engine cars can shift them
  const engGrp = new THREE.Group(); engGrp.position.x = LY.engineDX; stageGroups[0].add(engGrp);
  const cabGrp = new THREE.Group(); cabGrp.position.x = LY.cabinDX; stageGroups[2].add(cabGrp);
  const addE = (m) => { engGrp.add(m); return m; };
  const addC = (m) => { cabGrp.add(m); return m; };

  // glossy clear-coated paint
  const pm = cfg.paint || {};
  const paintBase = { metalness: pm.metalness ?? 0.55, roughness: pm.roughness ?? 0.34 };
  const paint = reg(3, new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(cfg.color), metalness: paintBase.metalness, roughness: paintBase.roughness,
    clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.85, side: THREE.DoubleSide,
  }));
  const steel = (c = '#2a2e35', st = 0, rough = 0.5) => reg(st, new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: rough }));
  const addEdges = (mesh, stage, op = 0.5) => {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), reg(stage, new THREE.LineBasicMaterial({ color: 0xc4d300, transparent: true, opacity: op }), op));
    mesh.add(e); return e;
  };

  // ===== body =====
  const stations = stationsFor(X0, X1, 190);
  const bodyGeo = loftGeometry(stations, sh.ringBody, 112);
  applyBumps(bodyGeo, sh);
  carveArches(bodyGeo, sh);
  bodyGeo.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeo, paint);
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
    for (const kk of [N / 4, 0, N / 2, (3 * N) / 4]) {
      const pts = []; for (let i = 0; i < stations.length; i++) pts.push(new THREE.Vector3().fromBufferAttribute(p, i * N + kk));
      ghostLines.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ghostLineMat));
    }
  }
  car.add(ghost, ghostLines);

  // ===== glass (greenhouse) =====
  const glassGeo = loftGeometry(stationsFor(GL.x0, GL.x1, 90), sh.ringGlass, 72);
  glassGeo.computeVertexNormals();
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x020304, metalness: 0.0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.0, transparent: true, opacity: 0 });
  const glass = new THREE.Mesh(glassGeo, glassMat); glass.renderOrder = 5;
  car.add(glass);

  // pillars / roof (paint patches over the glass loft)
  const ringPatch = (x0, x1, th0, th1, inflate, Nseg = 24, Mseg = 20) => {
    const pos = [], idx = [];
    stationsFor(x0, x1, Mseg).forEach((x) => {
      const r = sh.ringGlass(x);
      for (let k = 0; k <= Nseg; k++) {
        const th = th0 + ((th1 - th0) * k) / Nseg, c = Math.cos(th), s = Math.sin(th);
        const n = s >= 0 ? r.nTop : r.nBot, hh = s >= 0 ? r.hTop : r.hBot;
        const y = r.cy + hh * spow(s, 2 / n), z = spow(c, 2 / n) * r.w;
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
  add(3, new THREE.Mesh(ringPatch(GL.roof[0], GL.roof[1], PI / 2 - 0.5, PI / 2 + 0.5, 0.012, 20, 70), paint)); // roof panel
  for (const sgn of [1, -1]) { // A pillars
    const a0 = sgn > 0 ? PI / 2 - 0.72 : PI / 2 + 0.5, a1 = sgn > 0 ? PI / 2 - 0.5 : PI / 2 + 0.72;
    add(3, new THREE.Mesh(ringPatch(GL.a[0], GL.a[1], a0, a1, 0.012, 6, 20), paint));
  }
  add(3, new THREE.Mesh(ringPatch(GL.b, GL.b + 0.08, -0.15, PI + 0.15, 0.012, 30, 3), paint)); // B pillar hoop
  for (const sgn of [1, -1]) { // C pillars
    const a0 = sgn > 0 ? 0.05 : PI - 0.5, a1 = sgn > 0 ? 0.5 : PI - 0.05;
    add(3, new THREE.Mesh(ringPatch(GL.c[0], GL.c[1], a0, a1, 0.012, 8, 20), paint));
  }

  // door shut lines
  const lineMat = reg(3, new THREE.MeshBasicMaterial({ color: 0x0a0b0d }));
  for (const sgn of [1, -1]) for (const dx of GL.doors) {
    const y0 = 0.4, y1 = 0.8, z = bodyZAt(dx, 0.6);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.008, y1 - y0, 0.006), lineMat);
    m.position.set(dx, (y0 + y1) / 2, sgn * z); add(3, m);
  }
  // mirrors, spoiler lip, side skirts, bumper vents, wheel-arch liners
  for (const sgn of [1, -1]) {
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.09, 0.12, 3, 0.04), paint);
    mirror.position.set(GL.mirror, S(GL.mirror) + 0.08, sgn * 0.84); add(3, mirror);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.2), paint); stalk.position.set(GL.mirror + 0.04, S(GL.mirror) + 0.04, sgn * 0.74); add(3, stalk);
  }
  const blackTrim = reg(3, new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.55, metalness: 0.1 }));
  if (LY.ducktail) { // ducktail lip
    const lx = X0 + 0.2, lip = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.03, 0.9, 2, 0.012), paint);
    lip.position.set(lx, U(lx) + 0.004, 0); lip.rotation.z = 0.08; add(3, lip);
  } else { // small pop-up spoiler
    const lx = X0 + 0.34, lip = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.03, 0.95, 2, 0.012), paint);
    lip.position.set(lx, U(lx) + 0.012, 0); lip.rotation.z = 0.08; add(3, lip);
  }
  for (const sgn of [1, -1]) {
    const sk = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.05, 0.05, 2, 0.02), blackTrim);
    sk.position.set(0.12, 0.2, sgn * (bodyZAt(0.12, 0.2) + 0.005)); add(3, sk);
    const v = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.1, 0.34, 2, 0.02), blackTrim);
    v.position.set(frontX(0.33, 0.42) - 0.02, 0.33, sgn * 0.42); v.rotation.y = -sgn * 0.35; add(3, v);
    if (LY.sideIntake) { // mid-engine side intake behind the door
      const ix = -0.5 + LY.cabinDX * 0.2, iy = 0.64, iz = bodyZAt(ix, iy);
      const intake = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.2, 0.04, 2, 0.018), blackTrim); intake.position.set(ix, iy, sgn * (iz - 0.012)); add(3, intake);
      for (let k = -1; k <= 1; k++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.012), paint); sl.position.set(ix, iy + k * 0.055, sgn * (iz + 0.012)); add(3, sl); }
    }
  }
  const centreIntake = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.1, 0.5, 2, 0.02), blackTrim);
  centreIntake.position.set(frontX(0.34, 0) - 0.015, 0.34, 0); add(3, centreIntake);
  const linerMat = reg(3, new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  for (const w of WHEELS) { // dark wheel wells so the arches read as depth
    const lg = new THREE.Mesh(new THREE.CylinderGeometry(WR + 0.03, WR + 0.03, 0.38, 36, 1, true, PI / 2, PI), linerMat);
    lg.rotation.x = PI / 2; lg.position.set(w.x, WR, w.z * 0.9); add(3, lg);
  }

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
  // flat-six engine (rear in the 911, mid in the Cayman)
  const engMetal = steel('#4a5059', 0, 0.35), engDark = steel('#1d2025', 0, 0.5), engSilver = steel('#9aa1ab', 0, 0.3);
  const crank = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.24, 0.36, 3, 0.04), engDark); crank.position.set(-1.55, 0.38, 0); addE(crank); addEdges(crank, 0, 0.5);
  for (const sgn of [1, -1]) for (let i = 0; i < 3; i++) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.3, 24), engMetal);
    cyl.rotation.x = Math.PI / 2; cyl.position.set(-1.8 + i * 0.25, 0.38, sgn * 0.3); addE(cyl);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 24), engSilver);
    cap.rotation.x = Math.PI / 2; cap.position.set(-1.8 + i * 0.25, 0.38, sgn * 0.46); addE(cap);
  }
  const intake = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.1, 0.32, 3, 0.04), engSilver); intake.position.set(-1.55, 0.58, 0); addE(intake);
  for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 12), engSilver); t.position.set(-1.8 + i * 0.1, 0.5, (i % 2 ? 0.1 : -0.1)); addE(t); }
  const trans = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.26, 0.36, 3, 0.06), engMetal); trans.position.set(-0.95, 0.34, 0); addE(trans); addEdges(trans, 0, 0.5);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 14), engSilver); shaft.rotation.z = Math.PI / 2; shaft.position.set(0.15, 0.3, 0); add(0, shaft);
  const diff = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.2, 0.34, 3, 0.05), engMetal); diff.position.set(WHEELS[0].x, 0.31, 0); add(0, diff);
  const exMat = steel('#8e949c', 0, 0.28);
  for (const sgn of [1, -1]) {
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.75, 0.3, sgn * 0.22), new THREE.Vector3(-1.9, 0.24, sgn * 0.32), new THREE.Vector3(-2.05, 0.3, sgn * 0.4)]);
    addE(new THREE.Mesh(new THREE.TubeGeometry(path, 12, 0.04, 12), exMat));
  }
  const tank = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.2, 0.8, 3, 0.06), engDark); tank.position.set(X1 - 0.42, 0.34, 0); add(0, tank); addEdges(tank, 0, 0.4);
  const axleF = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.52, 12), engMetal); axleF.rotation.x = Math.PI / 2; axleF.position.set(WHEELS[0].x, WR, 0); add(0, axleF);
  const axleR = axleF.clone(); axleR.position.x = WHEELS[2].x; add(0, axleR);

  // ===== stage 1: wheels & brakes =====
  const tyreMat = reg(1, new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.8, metalness: 0.0 }));
  const rimMat = reg(1, new THREE.MeshStandardMaterial({ color: 0xd2d6dc, roughness: 0.2, metalness: 1 }));
  const rimDark = reg(1, new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }));
  const discMat = reg(1, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 1 }));
  const discHat = reg(1, new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.8 }));
  const caliperMat = reg(1, new THREE.MeshPhysicalMaterial({ color: 0xc4d300, roughness: 0.3, metalness: 0.2, clearcoat: 1 }));
  const tyreProfile = [];
  { // lathe: (radius, axial)
    const half = 0.12, R = WR;
    [[0.235, -half + 0.01], [0.27, -half], [0.32, -half * 0.95], [R - 0.005, -half * 0.55], [R, -0.0], [R - 0.005, half * 0.55], [0.32, half * 0.95], [0.27, half], [0.235, half - 0.01], [0.225, half - 0.04], [0.225, -half + 0.04]]
      .forEach(([r, a]) => tyreProfile.push(new THREE.Vector2(r, a)));
  }
  const spokeGeo = new RoundedBoxGeometry(0.17, 0.034, 0.034, 2, 0.012);
  const wheelTemplate = (wide) => {
    const g = new THREE.Group();
    const tg = new THREE.LatheGeometry(tyreProfile, 64); tg.scale(1, wide ? 1.1 : 1, 1);
    g.add(new THREE.Mesh(tg, tyreMat));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.228, 0.228, 0.2, 48, 1, true), rimDark); g.add(barrel);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.228, 0.013, 10, 64), rimMat); lip.rotation.x = Math.PI / 2; lip.position.y = 0.105; g.add(lip);
    for (let i = 0; i < 5; i++) { // twin spokes -> clearly visible star pattern, brakes show between them
      for (const off of [-0.115, 0.115]) {
        const a = (i / 5) * Math.PI * 2 + off;
        const sp = new THREE.Mesh(spokeGeo, rimMat);
        sp.position.set(Math.cos(a) * 0.145, 0.07, Math.sin(a) * 0.145); sp.rotation.y = -a; g.add(sp);
      }
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.05, 32), rimMat); hub.position.y = 0.065; g.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 24), caliperMat); cap.position.y = 0.095; g.add(cap);
    g.rotation.x = Math.PI / 2; // lathe Y axis -> Z axis
    return g;
  };
  for (const w of WHEELS) {
    const sg = Math.sign(w.z);
    const grp = new THREE.Group(); grp.position.set(w.x, WR, w.z);
    const wh = wheelTemplate(!w.front);
    if (w.z < 0) wh.rotation.x = -Math.PI / 2;
    grp.add(wh);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 48), discMat); disc.rotation.x = Math.PI / 2; disc.position.z = -sg * 0.035; grp.add(disc);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 32), discHat); hat.rotation.x = Math.PI / 2; hat.position.z = -sg * 0.015; grp.add(hat);
    const cal = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.1, 0.075, 2, 0.02), caliperMat); cal.position.set(0.1, 0.12, -sg * 0.035); cal.rotation.z = -0.55; grp.add(cal);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 10), steel('#4a5059', 1, 0.4)); arm.rotation.x = Math.PI / 2; arm.position.set(0, 0.0, -sg * 0.25); grp.add(arm);
    add(1, grp);
  }

  // ===== stage 2: cabin / interior =====
  const leather = reg(2, new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6, metalness: 0.05 }));
  const leather2 = reg(2, new THREE.MeshStandardMaterial({ color: 0x2d2b29, roughness: 0.55, metalness: 0.05 }));
  const accent = reg(2, new THREE.MeshStandardMaterial({ color: 0xc4d300, roughness: 0.5, metalness: 0.2 }));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.02, 1.15), leather); floor.position.set(-0.15, 0.3, 0); addC(floor);
  for (const sgn of [1, -1]) {
    const seatBase = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.12, 0.42, 4, 0.05), leather2); seatBase.position.set(-0.55, 0.42, sgn * 0.3); addC(seatBase);
    const seatBack = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.6, 0.42, 4, 0.05), leather2); seatBack.position.set(-0.8, 0.72, sgn * 0.3); seatBack.rotation.z = 0.18; addC(seatBack);
    const head = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.2, 0.26, 4, 0.04), leather2); head.position.set(-0.88, 1.1, sgn * 0.3); head.rotation.z = 0.15; addC(head);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.5, 0.02), accent); stripe.position.set(-0.755, 0.72, sgn * 0.3); stripe.rotation.z = 0.18; addC(stripe);
    const door = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.36, 0.06, 3, 0.03), leather); door.position.set(-0.05, 0.55, sgn * 0.72); addC(door);
  }
  const dash = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.2, 1.25, 4, 0.06), leather); dash.position.set(0.52, 0.8, 0); addC(dash);
  const binnacle = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.17, 0.4, 4, 0.05), leather); binnacle.position.set(0.5, 0.95, 0.3); addC(binnacle);
  const console_ = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.18, 0.2, 3, 0.05), leather2); console_.position.set(0.0, 0.45, 0); addC(console_);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.017, 12, 36), leather); sw.position.set(0.32, 0.9, 0.3); sw.rotation.set(0, Math.PI / 2, -0.35); addC(sw);
  const swc = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), accent); swc.position.copy(sw.position); swc.rotation.z = Math.PI / 2 - 0.35; addC(swc);
  const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.15, 10), steel('#aaa', 2, 0.3)); gear.position.set(0.1, 0.6, 0); addC(gear);
  const rearShelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 1.2), leather); rearShelf.position.set(-1.15, 0.52, 0); addC(rearShelf);

  // ===== stage 5: finishing touches =====
  const lightGlass = reg(5, new THREE.MeshPhysicalMaterial({ color: 0xf2f6f9, roughness: 0.05, metalness: 0.0, clearcoat: 1, emissive: 0xffffff, emissiveIntensity: 0.0 }));
  const lensMat = reg(5, new THREE.MeshPhysicalMaterial({ color: 0xe8f0f6, roughness: 0.02, metalness: 0, clearcoat: 1, envMapIntensity: 1.6 }), 0.42);
  const chrome = reg(5, new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.12, metalness: 1 }));
  const darkTrim = reg(5, new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 0.35, metalness: 0.2, side: THREE.DoubleSide }));
  const tail = reg(5, new THREE.MeshStandardMaterial({ color: 0x9b0b14, roughness: 0.2, metalness: 0.2, emissive: 0xff1020, emissiveIntensity: 0.0 }));
  for (const sgn of [1, -1]) {
    // round headlights sitting in the fender humps
    const hx = LT.x, hz = sgn * LT.z, hy = bodyTop(hx, hz) - 0.012, r = LT.r;
    const hl = new THREE.Group(); hl.position.set(hx, hy, hz); hl.rotation.z = -0.22; hl.rotation.x = sgn * 0.0;
    const bez = new THREE.Mesh(new THREE.SphereGeometry(r * 1.1, 32, 18), darkTrim); bez.scale.set(LT.sx, 0.34, 1); hl.add(bez);
    const refl = new THREE.Mesh(new THREE.SphereGeometry(r * 0.72, 24, 14), chrome); refl.scale.set(LT.sx, 0.42, 1); refl.position.y = 0.014; hl.add(refl);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(r * 0.26, 18, 12), lightGlass); bulb.position.set(0.0, r * 0.3, 0); hl.add(bulb);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 18), lensMat); lens.scale.set(LT.sx, 0.5, 1); lens.position.y = 0.012; lens.renderOrder = 6; hl.add(lens);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, 0.009, 8, 40), chrome); ring.rotation.x = Math.PI / 2; ring.scale.set(LT.sx, 1, 1); ring.position.y = 0.006; hl.add(ring);
    add(5, hl);
    const drl = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.03, 0.2, 2, 0.012), lightGlass); drl.position.set(frontX(0.4, 0.5) - 0.005, 0.4, sgn * 0.5); drl.rotation.y = -sgn * 0.5; add(5, drl);
    const ty = LY.rearLightBar ? 0.84 : 0.88, tz = LY.rearLightBar ? 0.42 : 0.5, tx = rearX(ty, tz) + 0.005;
    const tl = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.07, LY.rearLightBar ? 0.26 : 0.4, 3, 0.025), tail); tl.position.set(tx, ty, sgn * tz); tl.rotation.y = sgn * 0.3; add(5, tl);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.18, 24, 1, true), chrome); tip.rotation.z = Math.PI / 2; tip.position.set(rearX(0.3, 0.32) - 0.03, 0.3, sgn * 0.32); tip.material.side = THREE.DoubleSide; add(5, tip);
    const dxm = (GL.doors[0] + GL.doors[1]) / 2 - 0.12;
    const dh = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.025, 0.02, 2, 0.01), chrome); dh.position.set(dxm, S(dxm) - 0.07, sgn * (bodyZAt(dxm, S(dxm) - 0.07) + 0.008)); add(5, dh);
  }
  if (LY.rearLightBar) { const bar = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.03, 0.55, 2, 0.012), tail); bar.position.set(rearX(0.84, 0.0) + 0.01, 0.84, 0); add(5, bar); }
  if (LY.ducktail) { // engine grille slats on the deck lid
    const gx = X0 + 0.75, grille = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.012, 0.86, 2, 0.005), darkTrim); grille.position.set(gx, U(gx) + 0.004, 0); grille.rotation.z = Math.atan2(U(gx + 0.1) - U(gx - 0.1), 0.2) * -1; add(5, grille);
  }
  const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 20), chrome); badge.rotation.z = Math.PI / 2; badge.position.set(frontX(0.52, 0) + 0.0, 0.52, 0); add(5, badge);
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.01, 0.12, 0.34, 2, 0.004), chrome); plate.position.set(rearX(0.5, 0) + 0.005, 0.5, 0); add(5, plate);
  const wx = GL.a[1] - 0.05, wiper = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.5), darkTrim); wiper.position.set(wx, U(wx) + 0.012, 0.1); add(5, wiper);

  // ===== reflection (mirrored copy, hidden mostly by a floor sheet in main.js) =====
  const mirrorPairs = [];
  let mirror = null;
  if (cfg.shape.reflection !== false) {
    mirror = new THREE.Group(); mirror.scale.y = -1;
    const carClone = car.clone(true); mirror.add(carClone);
    carClone.traverse((o) => { o.renderOrder = -3; });
    car.children.forEach((c, i) => mirrorPairs.push([c, carClone.children[i]]));
    root.add(mirror);
  }

  // ===== animate / state API =====
  // levels: array of 6 progress values 0..1. Each stage fades in quickly (done by 45% of its own range),
  // so by the time the next stage is active the previous one is fully solid.
  const fade = (p) => sstep(0, 0.45, p);
  const stageAlpha = (i, p) => (i === 0 ? 0.3 + 0.7 * sstep(0, 0.5, p) : fade(p));
  function setProgress(levels) {
    for (let i = 0; i < 6; i++) {
      const e = fade(levels[i]), a = stageAlpha(i, levels[i]);
      stageGroups[i].visible = a > 0.004;
      stageGroups[i].position.y = (i === 1 || i === 2 || i === 5) ? (1 - e) * 0.14 : 0; // parts settle into place
      for (const { mat, base } of track[i]) {
        const o = a * base;
        mat.opacity = mat.isLineBasicMaterial ? o * (1 - fade(levels[3])) : o; mat.transparent = o < 0.995 || mat.isLineBasicMaterial; mat.depthWrite = o > 0.45;
        if (mat.isLineBasicMaterial) mat.depthWrite = false;
      }
    }
    const e3 = fade(levels[3]), e4 = fade(levels[4]), e5 = fade(levels[5]);
    // glass: black & opaque with the bodywork, turns real glass at stage 4
    glass.visible = e3 > 0.004;
    glassMat.opacity = e3 * (1 - 0.42 * e4);
    glassMat.color.setRGB(0.008 + 0.01 * e4, 0.011 + 0.02 * e4, 0.014 + 0.032 * e4);
    glassMat.envMapIntensity = 0.15 + 1.6 * e4;
    glassMat.depthWrite = e3 > 0.99 && e4 < 0.05;
    // ghost shell fades out as the paint becomes solid
    const gh = 1 - e3;
    ghost.visible = ghostLines.visible = gh > 0.004;
    ghostMat.opacity = 0.075 * gh; ghostLineMat.opacity = 0.26 * gh;
    // finishing: extra gloss + lights
    paint.roughness = paintBase.roughness - 0.1 * e5; paint.clearcoatRoughness = 0.07 - 0.05 * e5; paint.envMapIntensity = 0.85 + 0.2 * e5;
    lightGlass.emissiveIntensity = 0.9 * e5; tail.emissiveIntensity = 0.6 * e5;
    for (const [a, b] of mirrorPairs) { b.visible = a.visible; b.position.y = a.position.y; }
  }
  setProgress([0, 0, 0, 0, 0, 0]);
  root.userData.setProgress = setProgress;
  root.userData.bodyTop = bodyTop;
  root.userData.wheels = WHEELS;
  root.userData.bounds = { x0: X0, x1: X1, wheels: pf.wheels };
  return root;
}
