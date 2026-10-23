// Real-model car builder: loads a glTF/GLB (Draco-compressed OK) and drives the 6 build stages from it.
//
// ASSEMBLY MODEL — every transform is a pure function of the stage levels (no timers, no event history), so
// the build can be scrubbed in both directions and jumped to any amount:
//  * the model's meshes are grouped into "units" (a wheel, a body region, the seats, the front fascia ...)
//  * each unit has a stage, a delay inside that stage and an arrival direction (explicit in cfg.gltf.assembly
//    or derived: wheels from the sides, panels dropped from above / slid in along the car, trim pushed out ...)
//  * from the stage level L a unit gets its own local progress u = clamp((L - delay) / DUR):
//      u > 0     a lime hologram of the part appears at its start offset and flies in (ease-out-back = a small
//                overshoot and settle); wheels also spin down
//      0.1..0.9  the real PBR material sweeps in over the hologram with a glowing lime front
//      ~0.8      lock-in: lime edge glow + a burst of sparks, then it all fades out
//  * a faint static hologram ("blueprint") stays at the final position until the part has landed
//  * positions are applied in the vertex shader (world-space offset + spin), so the mirrored floor reflection
//    and the ghosts follow for free. Big body meshes are cut into front / cabin / rear region panels with a
//    clip plane in the shader (no geometry surgery), wheels are split per side.
//  * glass is part of the bodywork stage as black panels and turns into real glass at the glass stage;
//    paint is a clear-coated metallic in the car's configured colour.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { buildCoupe } from './carbuilder.js';

const LIME = new THREE.Color(0xc4d300);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const fade = (p) => sstep(0, 0.45, p);
const clean = (n) => String(n || '').replace(/[\s.\[\]:/]/g, ''); // GLTFLoader strips these from node names
const easeOutBack = (t, c1 = 1.15) => { const c3 = c1 + 1, x = t - 1; return 1 + c3 * x * x * x + c1 * x * x; };
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

// stage timeline: unit delays are spread over [0, DELAY_MAX], each unit then needs DUR of stage level.
// DELAY_MAX + DUR = 0.7 => every part of a stage has landed by 70% of that stage (the car is solid at 62%).
const DELAY_MAX = 0.4, DUR = 0.3;

let loaderSingleton = null;
function getLoader() {
  if (loaderSingleton) return loaderSingleton;
  const draco = new DRACOLoader();
  draco.setDecoderPath(new URL('../vendor/addons/libs/draco/', import.meta.url).href);
  draco.setDecoderConfig({ type: 'wasm' });
  const l = new GLTFLoader(); l.setDRACOLoader(draco);
  return (loaderSingleton = l);
}

// ---- shared GLSL: world-space offset + spin around a pivot, in "car space" (the floor mirror flips y) ----
const DISP_DECL = `uniform vec3 uOff; uniform float uSpin; uniform vec3 uPivot; varying vec3 vRest;`;
const DISP_PROJECT = `
  vec4 ctW = modelMatrix * vec4( transformed, 1.0 );
  float ctFl = determinant( mat3( modelMatrix ) ) < 0.0 ? -1.0 : 1.0;
  vec3 ctC = ctW.xyz; ctC.y *= ctFl;
  vRest = ctC;
  vec3 ctD = ctC - uPivot;
  float ctCs = cos( uSpin ), ctSn = sin( uSpin );
  ctD.xy = vec2( ctCs * ctD.x - ctSn * ctD.y, ctSn * ctD.x + ctCs * ctD.y );
  ctC = uPivot + ctD + uOff; ctC.y *= ctFl;
  vec4 mvPosition = viewMatrix * vec4( ctC, 1.0 );
  gl_Position = projectionMatrix * mvPosition;`;

// x-ray hologram: fresnel rim + contour lines.  uMode 0 = blueprint at the final position, 1 = the flying part
// (only where the real material has not swept in yet)
function makeGhostMaterial(U, mode, alpha) {
  return new THREE.ShaderMaterial({
    uniforms: { uOff: U.uOff, uSpin: U.uSpin, uPivot: U.uPivot, uClipX: U.uClipX, uSolid: U.uSolid, uRng: U.uRng, uSweep: U.uSweep,
      uAlpha: alpha, uMode: { value: mode }, uColor: { value: LIME } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `
      ${DISP_DECL}
      varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 transformed = position;
        #include <project_vertex>
        vec4 w0 = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w0.xyz);
      }`,
    fragmentShader: `
      uniform float uSolid, uAlpha, uMode; uniform vec2 uClipX, uRng; uniform vec3 uSweep, uColor;
      varying vec3 vN; varying vec3 vV; varying vec3 vRest;
      void main(){
        if (vRest.x < uClipX.x || vRest.x > uClipX.y) discard;
        if (uMode > 0.5) {
          float sT = (dot(vRest, uSweep) - uRng.x) / max(uRng.y - uRng.x, 0.001);
          if (sT <= uSolid * 1.12) discard;
        }
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.4);
        float c = abs(fract(vRest.y * 9.0) - 0.5); float line = 1.0 - smoothstep(0.0, 0.03, c);
        float c2 = abs(fract(vRest.x * 7.0) - 0.5); float line2 = 1.0 - smoothstep(0.0, 0.022, c2);
        float a = (0.03 + rim * 0.55 + line * 0.095 * (0.35 + f) + line2 * 0.05 * f) * (gl_FrontFacing ? 1.0 : 0.5);
        a *= uAlpha * (uMode > 0.5 ? 1.3 : 1.0);
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

// adds displacement, the region clip, the solidify sweep and the lime lock-in glow to a PBR material
function injectUnit(mat, U) {
  mat.onBeforeCompile = (sh) => {
    for (const k of ['uOff', 'uSpin', 'uPivot', 'uClipX', 'uSolid', 'uRng', 'uSweep', 'uFlash']) sh.uniforms[k] = U[k];
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${DISP_DECL}`)
      .replace('#include <project_vertex>', DISP_PROJECT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRest; uniform float uSolid, uFlash; uniform vec2 uClipX, uRng; uniform vec3 uSweep;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (vRest.x < uClipX.x || vRest.x > uClipX.y) discard;
        float ctS = (dot(vRest, uSweep) - uRng.x) / max(uRng.y - uRng.x, 0.001);
        float ctTh = uSolid * 1.12;
        if (ctS > ctTh) discard;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        float ctBand = uSolid < 0.999 ? 1.0 - smoothstep(0.0, 0.12, ctTh - ctS) : 0.0;
        float ctRim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.2);
        float ctEdge = 1.0 - smoothstep(0.0, 0.035, min(abs(vRest.x - uClipX.x), abs(uClipX.y - vRest.x)));
        float ctG = ctBand * ctBand * 0.9 + uFlash * (ctRim * 0.8 + ctEdge * 1.3);
        gl_FragColor.rgb += vec3(0.77, 0.83, 0.0) * ctG;`);
  };
  mat.customProgramCacheKey = () => 'unit2';
  mat.needsUpdate = true;
  return mat;
}

// split a mesh's triangles in two by a predicate on the triangle centroid (shares the vertex buffers)
function splitByTriangle(mesh, pred) {
  const g = mesh.geometry, pos = g.attributes.position;
  const idx = g.index ? g.index.array : null, n = idx ? idx.length : pos.count;
  const a = [], b = [], v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) { const vi = idx ? idx[i + k] : i + k; v.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld); c.add(v); }
    c.multiplyScalar(1 / 3);
    const dst = pred(c) ? a : b;
    for (let k = 0; k < 3; k++) dst.push(idx ? idx[i + k] : i + k);
  }
  const mk = (arr) => {
    const ng = new THREE.BufferGeometry(); for (const k of Object.keys(g.attributes)) ng.setAttribute(k, g.attributes[k]); ng.setIndex(arr);
    const bb = new THREE.Box3(); for (let i = 0; i < arr.length; i++) bb.expandByPoint(v.fromBufferAttribute(pos, arr[i]));   // bounds of the used vertices only
    ng.boundingBox = bb; ng.boundingSphere = bb.getBoundingSphere(new THREE.Sphere()); return ng;
  };
  return [a.length ? mk(a) : null, b.length ? mk(b) : null];
}

export function buildGltfCar(cfg, renderer) {
  const g = cfg.gltf;
  const A = g.assembly || {};
  const root = new THREE.Group();
  const car = new THREE.Group();
  root.add(car);
  root.userData.bounds = { x0: -2.2, x1: 2.3 };
  root.userData.wheels = [{ x: 1.27, z: 0.75 }, { x: 1.27, z: -0.75 }, { x: -1.16, z: 0.75 }, { x: -1.16, z: -0.75 }];
  root.userData.state = 'loading';

  const stageOf = new Map();
  for (const [st, names] of Object.entries(g.stages)) for (const n of names) stageOf.set(clean(n), +st);
  const defaultStage = g.defaultStage ?? 5;

  const units = [];    // assembly units
  const extras = [];   // procedural pieces (engine, interior) — also pieces of units
  let setFn = () => {};
  let fallback = null;
  root.userData.setProgress = (lv) => setFn(lv);

  function useFallback(err) {
    console.warn('[car-tracker] model failed to load, using procedural fallback:', err && err.message || err);
    car.clear(); units.length = 0;
    fallback = buildCoupe(cfg, renderer);
    root.add(fallback);
    root.userData.bounds = fallback.userData.bounds; root.userData.wheels = fallback.userData.wheels;
    root.userData.state = 'fallback';
    setFn = fallback.userData.setProgress;
    root.userData.onReady && root.userData.onReady();
  }

  // ---- materials ----
  const pt = cfg.paint || {};
  const paintBase = { roughness: pt.roughness ?? 0.3, clearcoatRoughness: 0.05 };
  const paintMat = () => new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(cfg.color), metalness: pt.metalness ?? 0.85, roughness: paintBase.roughness,
    clearcoat: 1, clearcoatRoughness: paintBase.clearcoatRoughness, envMapIntensity: pt.envMapIntensity ?? 1.0,
  });
  const matCache = new Map();
  const lightMats = new Set(g.lightMaterials || ['lights']);
  function realMaterial(src, unit, isGlass) {
    const key = src.uuid + ':' + unit.id + (isGlass ? 'g' : '');
    if (matCache.has(key)) return matCache.get(key);
    let m;
    if ((g.paintMaterials || ['paint']).includes(src.name)) m = paintMat();
    else if (isGlass) {
      m = new THREE.MeshPhysicalMaterial({ color: 0x050709, metalness: 0.85, roughness: 0.07, transparent: true, envMapIntensity: 0.3 });
      m.userData.glass = true;
    } else { m = src.clone(); }
    const ov = g.materialOverrides && g.materialOverrides[src.name];
    if (ov) { const { emissiveFromMap, ...rest } = ov; Object.assign(m, rest); if (emissiveFromMap && m.map) { m.emissive.set(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = emissiveFromMap; } }
    if (m.map) m.map.anisotropy = 4;
    if (lightMats.has(src.name) && !m.emissiveMap) { m.emissive = new THREE.Color(0xfff1d0); m.emissiveIntensity = 0; m.userData.lamp = true; }
    injectUnit(m, unit.U);
    m.userData.srcName = src.name;
    matCache.set(key, m);
    return m;
  }

  // ---- units ----
  let unitCount = 0;
  const unitMap = new Map();
  function unitFor(key, stage) {
    const k = stage + '|' + key;
    if (unitMap.has(k)) return unitMap.get(k);
    const U = {
      uOff: { value: new THREE.Vector3() }, uSpin: { value: 0 }, uPivot: { value: new THREE.Vector3() },
      uClipX: { value: new THREE.Vector2(-1e3, 1e3) }, uSolid: { value: 0 }, uRng: { value: new THREE.Vector2(0, 1) },
      uSweep: { value: new THREE.Vector3(0, 1, 0) }, uFlash: { value: 0 },
    };
    const u = { id: unitCount++, key, stage, U, pieces: [], rule: A[key] || {}, alphaFly: { value: 0 }, alphaHome: { value: 1 }, delay: 0,
      dir: new THREE.Vector3(), dist: 1, spin: 0, box: new THREE.Box3(), center: new THREE.Vector3(), sparkIdx: 0 };
    unitMap.set(k, u); units.push(u);
    return u;
  }

  getLoader().load(new URL(g.url, location.href).href, (gltf) => {
    try {
      const model = gltf.scene;
      const hide = new Set((g.hide || []).map(clean));
      const hideMats = new Set(g.hideMaterials || []);
      model.rotation.y = g.rotateY ?? Math.PI / 2;
      car.add(model);
      model.updateMatrixWorld(true);
      const glassMats = new Set(g.glassMaterials || ['window', 'glass']);
      const meshes = [];
      model.traverse((o) => { if (o.isMesh) meshes.push(o); });

      // 1. classify meshes -> pieces; split wheels per side, body into front / cabin / rear panels
      const pieces = [];
      const splitNodes = new Set((g.splitSideNodes || g.wheelNodes || []).map(clean));
      const regionNodes = new Set((g.regionNodes || []).map(clean));
      const cuts = g.regionCuts || [];   // car-space x of the cut planes, rear -> front
      const regionName = ['rear', 'cabin', 'front'];
      const worldBox = (m) => new THREE.Box3().setFromObject(m);
      for (const o of meshes) {
        const names = [o.name, o.parent && o.parent.name, o.parent && o.parent.parent && o.parent.parent.name].map(clean);
        const srcMat = o.material;
        if (names.some((n) => hide.has(n)) || hideMats.has(srcMat.name)) { o.visible = false; o.userData.hidden = true; continue; }
        let stage = defaultStage;
        for (const n of names) if (stageOf.has(n)) { stage = stageOf.get(n); break; }
        const isGlass = glassMats.has(srcMat.name) && (g.glassStage ?? 4) === 4 && !(g.opaqueGlassNodes || []).includes(names[1]);
        const revealStage = isGlass ? 3 : stage;
        const node = names[1];
        const base = { srcMat, stage: revealStage, glass: isGlass, node };
        if (splitNodes.has(node)) {
          const [pos, neg] = splitByTriangle(o, (c) => c.z > 0);
          const par = o.parent; par.remove(o);
          [[pos, 'L'], [neg, 'R']].forEach(([geo, side]) => {
            if (!geo) return;
            const m = new THREE.Mesh(geo, srcMat); m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale); m.name = o.name + side;
            par.add(m); m.updateMatrixWorld(true);
            pieces.push({ ...base, mesh: m, key: `wheel_${node.replace(/\d+$/, '')}_${side}_${node}`, wheel: side });
          });
        } else if (regionNodes.has(node) && !isGlass && revealStage === 3 && cuts.length) {
          const bb = worldBox(o); const par = o.parent; par.remove(o);
          const edges = [-1e3, ...cuts, 1e3];
          for (let r = 0; r < edges.length - 1; r++) {
            if (bb.max.x < edges[r] || bb.min.x > edges[r + 1]) continue;
            const m = new THREE.Mesh(o.geometry, srcMat); m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale); m.name = o.name + '_' + regionName[r];
            par.add(m); m.updateMatrixWorld(true);
            pieces.push({ ...base, mesh: m, key: 'region_' + regionName[r], clip: [edges[r], edges[r + 1]] });
          }
        } else {
          pieces.push({ ...base, mesh: o, key: isGlass ? 'glass_' + node : node });
        }
      }

      // 2. sit the tyres on the floor
      model.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const p of pieces) box.expandByObject(p.mesh);
      car.position.y = -box.min.y; car.updateMatrixWorld(true);
      model.updateMatrixWorld(true);
      box.setFromObject(model); box.min.y = 0;

      // 3. units: bounds, centre, arrival direction, delay
      for (const p of pieces) { const u = unitFor(p.key, p.stage); u.pieces.push(p); p.unit = u; }
      const carC = new THREE.Vector3((box.min.x + box.max.x) / 2, 0.55, 0);
      const sizeX = box.max.x - box.min.x;
      const stageDef = g.stageDefaults || [
        { dir: [-1, 0.28, 0], dist: 2.4 },   // 0 foundation: chassis parts roll in from behind
        { dir: 'side', dist: 1.9 },          // 1 wheels: from the sides
        { dir: [0, 1, 0], dist: 1.5 },       // 2 cabin: dropped in from above
        { dir: 'radial', dist: 1.7 },        // 3 body: panels from above / front / rear / sides
        { dir: [0, 1, 0], dist: 0.45 },      // 4 glazing trim
        { dir: 'radial', dist: 0.9 },        // 5 finishing: pushed on from outside
      ];
      const finishUnit = (u) => {
        u.box.makeEmpty();
        for (const p of u.pieces) u.box.union(worldBox(p.mesh));
        const clip = u.pieces[0].clip;
        if (clip) { u.box.min.x = Math.max(u.box.min.x, clip[0]); u.box.max.x = Math.min(u.box.max.x, clip[1]); }
        u.box.getCenter(u.center);
        if (clip) { u.U.uClipX.value.set(clip[0], clip[1]); }
        const sd = stageDef[u.stage], r = u.rule;
        let dir = r.dir || sd.dir;
        if (dir === 'side') dir = [0, 0.18, u.center.z >= 0 ? 1 : -1];
        else if (dir === 'radial') {
          const dx = (u.center.x - carC.x) / (sizeX / 2), dy = u.center.y - carC.y, dz = u.center.z / 0.9;
          dir = [dx * 1.0, 0.45 + Math.max(0, dy) * 0.9, dz * 1.1];
          if (Math.hypot(...dir) < 0.5) dir = [0, 1, 0];
        }
        u.dir.set(...dir).normalize();
        u.dist = r.dist ?? sd.dist;
        u.spin = r.spin ?? (u.pieces[0].wheel ? (u.pieces[0].wheel === 'L' ? 1 : -1) * Math.PI * 2.2 : 0);
        // sweep direction: the real material takes over starting from the side the part flies in from
        u.U.uSweep.value.copy(u.dir).multiplyScalar(-1);
        let lo = 1e9, hi = -1e9; const c = new THREE.Vector3();
        for (const x of [u.box.min.x, u.box.max.x]) for (const y of [u.box.min.y, u.box.max.y]) for (const z of [u.box.min.z, u.box.max.z]) {
          const d = c.set(x, y, z).dot(u.U.uSweep.value); lo = Math.min(lo, d); hi = Math.max(hi, d);
        }
        u.U.uRng.value.set(lo, hi);
        u.U.uPivot.value.copy(u.center);
      };
      const addExtraUnits = () => {};
      // delays: explicit `order` in the rules, else rear -> front by centre
      const finalizeStage = (st) => {
        const us = units.filter((u) => u.stage === st); us.forEach(finishUnit);
        us.sort((a, b) => (a.rule.order ?? 50 + a.center.x * 10) - (b.rule.order ?? 50 + b.center.x * 10));
        us.forEach((u, i) => { u.delay = us.length > 1 ? (i / (us.length - 1)) * DELAY_MAX : 0; if (u.rule.delay !== undefined) u.delay = u.rule.delay * DELAY_MAX; });
      };

      // 4. materials + ghosts per piece
      const makePiece = (p) => {
        const m = p.mesh, u = p.unit;
        m.material = realMaterial(p.srcMat, u, p.glass);
        m.renderOrder = p.glass ? 2 : 0; m.frustumCulled = false;
        const mk = (mode, alpha) => {
          const gh = new THREE.Mesh(m.geometry, makeGhostMaterial(u.U, mode, alpha));
          gh.renderOrder = 5; gh.frustumCulled = false;
          m.parent.add(gh); gh.position.copy(m.position); gh.quaternion.copy(m.quaternion); gh.scale.copy(m.scale);
          return gh;
        };
        p.fly = mk(1, u.alphaFly); p.home = mk(0, u.alphaHome);
      };
      pieces.forEach(makePiece);

      // wheel dimensions
      const wheels = [];
      const wb = (names) => { const b = new THREE.Box3(); for (const p of pieces) if (names.includes(clean(p.node))) b.expandByObject(p.mesh); return b; };
      for (const nm of (g.wheelNodes || [])) {
        const b = wb([clean(nm)]); if (b.isEmpty()) continue;
        const cx = (b.min.x + b.max.x) / 2, hz = (b.max.z - b.min.z) / 2;
        wheels.push({ x: cx, z: hz - 0.15 }, { x: cx, z: -(hz - 0.15) });
      }
      if (wheels.length) root.userData.wheels = wheels;
      root.userData.bounds = { x0: box.min.x, x1: box.max.x };

      // procedural extras the scanned model doesn't contain (flat-six, subframe, dash, wheel)
      if (g.extras !== false) addExtras(box, carC, sizeX, makePiece);
      for (let st = 0; st < 6; st++) finalizeStage(st);

      // sparks: lime embers on a part's edges as it locks in (positions are a pure function of progress)
      const SP = 7, nSp = units.length * SP;
      const spPos = new Float32Array(nSp * 3), spA = new Float32Array(nSp), spBase = new Float32Array(nSp * 3), spVel = new Float32Array(nSp * 3);
      const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
      units.forEach((u, ui) => {
        const e = u.box.getSize(new THREE.Vector3()), bmin = u.box.min, bmax = u.box.max;
        for (let k = 0; k < SP; k++) {
          const i = (ui * SP + k) * 3;
          // a random point on one of the box's edges, biased to the leading (arrival) side
          const ax = Math.floor(rnd() * 3), pick = (lo, hi) => (rnd() < 0.5 ? lo : hi);
          const p = [pick(bmin.x, bmax.x), pick(bmin.y, bmax.y), pick(bmin.z, bmax.z)]; p[ax] = bmin.getComponent(ax) + rnd() * e.getComponent(ax);
          spBase[i] = p[0]; spBase[i + 1] = p[1]; spBase[i + 2] = p[2];
          spVel[i] = (rnd() - 0.5) * 0.7 + u.dir.x * 0.25; spVel[i + 1] = 0.25 + rnd() * 0.6; spVel[i + 2] = (rnd() - 0.5) * 0.7 + u.dir.z * 0.25;
        }
      });
      const spGeo = new THREE.BufferGeometry();
      spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute('aA', new THREE.BufferAttribute(spA, 1));
      const spMat = new THREE.ShaderMaterial({
        uniforms: { uPR: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `uniform float uPR; attribute float aA; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = (2.0 + 9.0 * aA) * uPR * (6.0 / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.0, 1.0, d)); a *= a * vA; gl_FragColor = vec4(vec3(0.85, 0.95, 0.15) * a * 1.6, a); }`,
      });
      const sparks = new THREE.Points(spGeo, spMat); sparks.frustumCulled = false; sparks.renderOrder = 6;
      root.add(sparks);

      // reflection: mirrored clone sharing geometry + materials
      let mirror = null; const mirrorPairs = [];
      if (cfg.shape?.reflection !== false) {
        mirror = new THREE.Group(); mirror.scale.y = -1;
        const c = car.clone(true); mirror.add(c);
        const srcMeshes = [], dstMeshes = [];
        car.traverse((o) => { if (o.isMesh) srcMeshes.push(o); }); c.traverse((o) => { if (o.isMesh) dstMeshes.push(o); });
        srcMeshes.forEach((s, i) => { dstMeshes[i].renderOrder = -3; dstMeshes[i].frustumCulled = false; mirrorPairs.push([s, dstMeshes[i]]); });
        root.add(mirror);
      }

      const tmp = new THREE.Vector3();
      setFn = (levels) => {
        const e = levels.map(fade);
        for (const u of units) {
          const L = levels[u.stage];
          const t = clamp01((L - u.delay) / DUR);
          const place = t >= 1 ? 0 : 1 - easeOutBack(clamp01(t / 0.85));
          u.U.uOff.value.copy(u.dir).multiplyScalar(u.dist * place);
          u.U.uSpin.value = u.spin * (t >= 1 ? 0 : 1 - easeOutCubic(clamp01(t / 0.85)));
          const solid = t >= 1 ? 1 : sstep(0.12, 0.85, t);
          u.U.uSolid.value = solid;
          const lock = sstep(0.55, 0.8, t) * (1 - sstep(0.8, 1.0, t));
          u.U.uFlash.value = t >= 1 ? 0 : lock;
          u.alphaFly.value = sstep(0, 0.1, t) * (solid >= 1 ? 0 : 1);
          u.alphaHome.value = 1 - sstep(0.55, 0.95, t);
          const on = t > 0, done = t >= 1;
          for (const p of u.pieces) {
            p.mesh.visible = on; p.fly.visible = on && !done; p.home.visible = t < 1;
            if (p.glass) {
              const m = p.mesh.material, e4 = e[4];
              m.opacity = 1 - 0.58 * e4;
              m.color.setRGB(0.008 + 0.012 * e4, 0.011 + 0.02 * e4, 0.014 + 0.034 * e4);
              m.envMapIntensity = 0.3 + 1.5 * e4; m.depthWrite = e4 < 0.05;
            }
          }
          u.t = t;
        }
        const e5 = e[5];
        for (const m of matCache.values()) {
          if (m.isMeshPhysicalMaterial && m.userData.srcName === 'paint') { m.roughness = paintBase.roughness - 0.08 * e5; m.clearcoatRoughness = paintBase.clearcoatRoughness - 0.03 * e5; }
        }
        // lamps glow on as the finishing touches land
        for (const u of units) if (u.stage === 5) { const glow = sstep(0.6, 0.85, u.t) * 1.0 + 0.35 * sstep(0.95, 1.0, u.t); for (const p of u.pieces) if (p.mesh.material.userData.lamp) p.mesh.material.emissiveIntensity = Math.min(1.1, glow); }
        // sparks
        let live = false;
        units.forEach((u, ui) => {
          const tau = (u.t - 0.72) / 0.28, on = tau > 0 && tau < 1;
          for (let k = 0; k < SP; k++) {
            const j = ui * SP + k, i = j * 3;
            if (!on) { spA[j] = 0; continue; }
            const s = tau * tau * 0.5 + tau * 0.5;
            tmp.copy(u.U.uOff.value);
            spPos[i] = spBase[i] + tmp.x + spVel[i] * s * 0.5; spPos[i + 1] = spBase[i + 1] + tmp.y + spVel[i + 1] * s * 0.5 - 0.35 * tau * tau * 0.5; spPos[i + 2] = spBase[i + 2] + tmp.z + spVel[i + 2] * s * 0.5;
            spA[j] = Math.pow(1 - tau, 1.4) * (0.55 + 0.45 * Math.sin((k + 1) * 12.9898 + tau * 6)); live = true;
          }
        });
        spGeo.attributes.position.needsUpdate = true; spGeo.attributes.aA.needsUpdate = true; sparks.visible = true;
        for (const [a, b] of mirrorPairs) b.visible = a.visible;
      };
      root.userData.state = 'ready';
      root.userData.units = units;
      root.userData.onReady && root.userData.onReady();
    } catch (err) { useFallback(err); }
  }, undefined, (err) => useFallback(err));

  // ---------- procedural extras (stage 0 drivetrain, stage 2 cockpit) ----------
  function addExtras(box, carC, sizeX, makePiece) {
    const x0 = box.min.x;
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e24, metalness: 0.85, roughness: 0.38 });
    const alu = new THREE.MeshStandardMaterial({ color: 0x8c939c, metalness: 1, roughness: 0.32 });
    const lime = new THREE.MeshStandardMaterial({ color: 0x1a1d00, emissive: 0xc4d300, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.4 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.1, roughness: 0.62 });
    const add = (stage, key, geo, mat, pos, rot) => {
      const mesh = new THREE.Mesh(geo, mat); mesh.position.set(pos[0], pos[1] - car.position.y, pos[2]); if (rot) mesh.rotation.set(...rot);
      car.add(mesh); mesh.updateMatrixWorld(true);
      const u = unitFor(key, stage);
      const p = { mesh, srcMat: mat, stage, glass: false, node: key, key, unit: u, extra: true };
      u.pieces.push(p); makePiece(p); extras.push(p);
    };
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const C = (r, l, s = 24) => new THREE.CylinderGeometry(r, r, l, s);
    const rx = g.engineX ?? -1.62, ry = g.engineY ?? 0.36;
    // stage 0 — rear-engine drivetrain: flat-six, gearbox, subframe, axles, exhaust
    for (const s of [-1, 1]) {
      const n = s > 0 ? 'L' : 'R';
      add(0, 'engine' + n, B(0.62, 0.2, 0.26), dark, [rx, ry, s * 0.22]);                      // cylinder bank
      for (let i = 0; i < 3; i++) add(0, 'engine' + n, C(0.06, 0.14), alu, [rx - 0.2 + i * 0.2, ry, s * 0.4], [Math.PI / 2, 0, 0]); // heads
      add(0, 'engine' + n, B(0.7, 0.04, 0.05), lime, [rx, ry + 0.12, s * 0.45]);
      add(0, 'subframe' + n, B(1.5, 0.07, 0.07), dark, [-0.4, 0.24, s * 0.56]);                   // subframe rails
      add(0, 'exhaust' + n, C(0.035, 0.45), alu, [x0 + 0.42, 0.22, s * 0.22], [0, 0, Math.PI / 2]); // exhaust
    }
    add(0, 'plenum', B(0.5, 0.14, 0.4), alu, [rx + 0.2, ry + 0.16, 0]);                         // intake plenum
    add(0, 'gearbox', C(0.1, 0.5), dark, [rx + 0.56, ry - 0.02, 0], [0, 0, Math.PI / 2]);        // gearbox
    add(0, 'axleF', C(0.025, 1.25), dark, [1.27, 0.34, 0], [Math.PI / 2, 0, 0]);               // front axle
    add(0, 'axleR', C(0.025, 1.25), dark, [-1.16, 0.34, 0], [Math.PI / 2, 0, 0]);              // rear axle
    // stage 2 — cockpit: dash, console, steering wheel, seat bases
    add(2, 'dash', B(0.3, 0.12, 1.25), leather, [0.38, 0.86, 0]);
    add(2, 'console', B(0.9, 0.18, 0.2), leather, [-0.15, 0.55, 0]);
    add(2, 'steering', new THREE.TorusGeometry(0.17, 0.018, 12, 32), leather, [0.3, 0.93, -0.36], [0, Math.PI / 2 - 0.45, 0]);
    for (const s of [-1, 1]) add(2, 'seatbase' + (s > 0 ? 'L' : 'R'), B(0.5, 0.1, 0.42), leather, [-0.3, 0.56, s * 0.36]);
  }

  return root;
}
