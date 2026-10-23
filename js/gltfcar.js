// Real-model car builder: loads a glTF/GLB (Draco-compressed OK) and drives the 6 build stages from it.
//
// How the stages work on a real, mostly-single-body model (no per-part build order inside the file):
//  * every mesh is assigned to a stage (cfg.gltf.stages: stage index -> node names; default = last stage)
//  * until its stage is built a mesh is drawn as an x-ray "hologram" (fresnel rim + contour lines, lime)
//  * as the stage fills, a scan front sweeps rear -> front: behind it the real PBR material, in front the hologram
//  * glass is part of the bodywork stage as black opaque panels, and turns into real glass at the glass stage
//  * paint is replaced with a clear-coated metallic paint in the car's configured colour
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { buildCoupe } from './carbuilder.js';

const LIME = new THREE.Color(0xc4d300);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fade = (p) => sstep(0, 0.45, p);
const clean = (n) => String(n || '').replace(/[\s.\[\]:/]/g, ''); // GLTFLoader strips these from node names

let loaderSingleton = null;
function getLoader() {
  if (loaderSingleton) return loaderSingleton;
  const draco = new DRACOLoader();
  draco.setDecoderPath(new URL('../vendor/addons/libs/draco/', import.meta.url).href);
  draco.setDecoderConfig({ type: 'wasm' });
  const l = new GLTFLoader(); l.setDRACOLoader(draco);
  return (loaderSingleton = l);
}

// x-ray hologram material: fresnel rim + horizontal contour lines, only drawn ahead of the reveal front
function makeGhostMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { uReveal: U.uReveal, uX0: U.uX0, uX1: U.uX1, uColor: { value: LIME }, uGhost: { value: 1 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec4 w = modelMatrix * vec4(position,1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uReveal, uX0, uX1, uGhost; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float th = mix(uX0 - 0.2, uX1 + 0.2, uReveal);
        if (vW.x <= th) discard;
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.4);
        float c = abs(fract(vW.y * 9.0) - 0.5); float line = 1.0 - smoothstep(0.0, 0.03, c);
        float c2 = abs(fract(vW.x * 7.0) - 0.5); float line2 = 1.0 - smoothstep(0.0, 0.022, c2);
        float a = (0.03 + rim * 0.55 + line * 0.095 * (0.35 + f) + line2 * 0.05 * f) * uGhost * (gl_FrontFacing ? 1.0 : 0.5);
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

// adds the reveal-front discard + glowing lime scan band to a PBR material
function injectReveal(mat, U) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uReveal = U.uReveal; sh.uniforms.uX0 = U.uX0; sh.uniforms.uX1 = U.uX1;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRX;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRX = (modelMatrix * vec4(transformed, 1.0)).x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRX; uniform float uReveal, uX0, uX1;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float rvTh = mix(uX0 - 0.2, uX1 + 0.2, uReveal);
        if (vRX > rvTh) discard;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        if (uReveal < 0.999) { float band = 1.0 - smoothstep(0.0, 0.16, rvTh - vRX); gl_FragColor.rgb += vec3(0.77, 0.83, 0.0) * band * band * 0.9; }`);
  };
  mat.customProgramCacheKey = () => 'reveal1';
  mat.needsUpdate = true;
  return mat;
}

export function buildGltfCar(cfg, renderer) {
  const g = cfg.gltf;
  const root = new THREE.Group();
  const car = new THREE.Group();
  root.add(car);
  root.userData.bounds = { x0: -2.2, x1: 2.3 };
  root.userData.wheels = [{ x: 1.27, z: 0.75 }, { x: 1.27, z: -0.75 }, { x: -1.16, z: 0.75 }, { x: -1.16, z: -0.75 }];
  root.userData.state = 'loading';

  // per-stage shared uniforms
  const SU = Array.from({ length: 6 }, () => ({ uReveal: { value: 0 }, uX0: { value: -2.2 }, uX1: { value: 2.3 } }));
  const stageOf = new Map();
  for (const [st, names] of Object.entries(g.stages)) for (const n of names) stageOf.set(clean(n), +st);
  const defaultStage = g.defaultStage ?? 5;

  const parts = [];   // { real: Mesh, ghost: Mesh, stage, glass }
  const extras = [];  // procedural meshes (engine, interior)
  let setFn = () => {};
  let fallback = null;
  root.userData.setProgress = (lv) => setFn(lv);

  function useFallback(err) {
    console.warn('[car-tracker] model failed to load, using procedural fallback:', err && err.message || err);
    car.clear(); parts.length = 0;
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
  function realMaterial(src, stage, isGlass, nodeName) {
    const key = src.uuid + ':' + stage + (isGlass ? 'g' : '');
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
    injectReveal(m, SU[stage]);
    m.userData.srcName = src.name;
    matCache.set(key, m);
    return m;
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
      for (const o of meshes) {
        const names = [o.name, o.parent && o.parent.name, o.parent && o.parent.parent && o.parent.parent.name].map(clean);
        const srcMat = o.material;
        if (names.some((n) => hide.has(n)) || hideMats.has(srcMat.name)) { o.visible = false; o.userData.hidden = true; continue; }
        let stage = defaultStage;
        for (const n of names) if (stageOf.has(n)) { stage = stageOf.get(n); break; }
        const isGlass = glassMats.has(srcMat.name) && (g.glassStage ?? 4) === 4 && !(g.opaqueGlassNodes || []).includes(names[1]);
        // glass renders as part of the bodywork stage (black), then becomes real glass at the glass stage
        const revealStage = isGlass ? 3 : stage;
        o.material = realMaterial(srcMat, revealStage, isGlass, names[1]);
        o.renderOrder = isGlass ? 2 : 0;
        o.frustumCulled = true;
        const ghost = new THREE.Mesh(o.geometry, makeGhostMaterial(SU[revealStage]));
        ghost.renderOrder = 5; ghost.frustumCulled = true;
        o.parent.add(ghost); ghost.position.copy(o.position); ghost.quaternion.copy(o.quaternion); ghost.scale.copy(o.scale);
        parts.push({ real: o, ghost, stage: revealStage, glass: isGlass });
      }
      // sit the tyres on the floor, measure length / wheels
      model.updateMatrixWorld(true);
      const box = new THREE.Box3();
      for (const p of parts) box.expandByObject(p.real);
      car.position.y = -box.min.y; car.updateMatrixWorld(true);
      box.setFromObject(model); box.min.y = 0;
      const wb = (names) => { const b = new THREE.Box3(); for (const p of parts) if (names.includes(clean(p.real.parent.name))) b.expandByObject(p.real); return b; };
      const wheels = [];
      for (const nm of (g.wheelNodes || [])) {
        const b = wb([clean(nm)]); if (b.isEmpty()) continue;
        const cx = (b.min.x + b.max.x) / 2, hz = (b.max.z - b.min.z) / 2;
        wheels.push({ x: cx, z: hz - 0.15 }, { x: cx, z: -(hz - 0.15) });
      }
      if (wheels.length) root.userData.wheels = wheels;
      root.userData.bounds = { x0: box.min.x, x1: box.max.x };
      for (const U of SU) { U.uX0.value = box.min.x; U.uX1.value = box.max.x; }

      // procedural extras the scanned model doesn't contain (flat-six, subframe, dash, wheel)
      if (g.extras !== false) addExtras(box);

      // reflection: mirrored clone sharing geometry + materials
      let mirror = null; const mirrorPairs = [];
      if (cfg.shape?.reflection !== false) {
        mirror = new THREE.Group(); mirror.scale.y = -1;
        const c = car.clone(true); mirror.add(c);
        const srcMeshes = [], dstMeshes = [];
        car.traverse((o) => { if (o.isMesh) srcMeshes.push(o); }); c.traverse((o) => { if (o.isMesh) dstMeshes.push(o); });
        srcMeshes.forEach((s, i) => { dstMeshes[i].renderOrder = -3; mirrorPairs.push([s, dstMeshes[i]]); });
        root.add(mirror);
      }

      setFn = (levels) => {
        const e = levels.map(fade);
        for (let i = 0; i < 6; i++) SU[i].uReveal.value = e[i] >= 0.999 ? 1 : e[i];
        for (const p of parts) {
          const done = SU[p.stage].uReveal.value >= 1, none = SU[p.stage].uReveal.value <= 0.001;
          p.real.visible = !none; p.ghost.visible = !done;
          if (p.glass) {
            const m = p.real.material, e4 = e[4];
            m.opacity = 1 - 0.58 * e4;
            m.color.setRGB(0.008 + 0.012 * e4, 0.011 + 0.02 * e4, 0.014 + 0.034 * e4);
            m.envMapIntensity = 0.3 + 1.5 * e4; m.depthWrite = e4 < 0.05;
          }
        }
        for (const x of extras) {
          const none = SU[x.stage].uReveal.value <= 0.001, done = SU[x.stage].uReveal.value >= 1;
          x.real.visible = !none; x.ghost.visible = !done;
        }
        const e5 = e[5];
        for (const m of matCache.values()) if (m.isMeshPhysicalMaterial && m.userData.srcName === 'paint') { m.roughness = paintBase.roughness - 0.08 * e5; m.clearcoatRoughness = paintBase.clearcoatRoughness - 0.03 * e5; }
        for (const [a, b] of mirrorPairs) b.visible = a.visible;
      };
      root.userData.state = 'ready';
      root.userData.onReady && root.userData.onReady();
    } catch (err) { useFallback(err); }
  }, undefined, (err) => useFallback(err));

  // ---------- procedural extras (stage 0 drivetrain, stage 2 cockpit) ----------
  function addExtras(box) {
    const x0 = box.min.x, x1 = box.max.x;
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e24, metalness: 0.85, roughness: 0.38 });
    const alu = new THREE.MeshStandardMaterial({ color: 0x8c939c, metalness: 1, roughness: 0.32 });
    const lime = new THREE.MeshStandardMaterial({ color: 0x1a1d00, emissive: 0xc4d300, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.4 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.1, roughness: 0.62 });
    const add = (stage, geo, mat, pos, rot) => {
      const m = realMaterialFor(mat, stage);
      const mesh = new THREE.Mesh(geo, m); mesh.position.set(pos[0], pos[1] - car.position.y, pos[2]); if (rot) mesh.rotation.set(...rot);
      const ghost = new THREE.Mesh(geo, makeGhostMaterial(SU[stage])); ghost.renderOrder = 5;
      ghost.position.copy(mesh.position); ghost.rotation.copy(mesh.rotation);
      car.add(mesh, ghost); extras.push({ real: mesh, ghost, stage });
    };
    function realMaterialFor(src, stage) { const k = src.uuid + ':x' + stage; if (!matCache.has(k)) { const m = src.clone(); injectReveal(m, SU[stage]); matCache.set(k, m); } return matCache.get(k); }
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const C = (r, l, s = 24) => new THREE.CylinderGeometry(r, r, l, s);
    const rx = g.engineX ?? -1.62, ry = g.engineY ?? 0.36;
    // stage 0 — rear-engine drivetrain: flat-six, gearbox, subframe, axles, exhaust
    for (const s of [-1, 1]) {
      add(0, B(0.62, 0.2, 0.26), dark, [rx, ry, s * 0.22]);                      // cylinder bank
      for (let i = 0; i < 3; i++) add(0, C(0.06, 0.14), alu, [rx - 0.2 + i * 0.2, ry, s * 0.4], [Math.PI / 2, 0, 0]); // heads
      add(0, B(0.7, 0.04, 0.05), lime, [rx, ry + 0.12, s * 0.45]);
      add(0, B(1.5, 0.07, 0.07), dark, [-0.4, 0.24, s * 0.56]);                   // subframe rails
      add(0, C(0.035, 0.45), alu, [x0 + 0.42, 0.22, s * 0.22], [0, 0, Math.PI / 2]); // exhaust
    }
    add(0, B(0.5, 0.14, 0.4), alu, [rx + 0.2, ry + 0.16, 0]);                         // intake plenum
    add(0, C(0.1, 0.5), dark, [rx + 0.56, ry - 0.02, 0], [0, 0, Math.PI / 2]);        // gearbox
    add(0, C(0.025, 1.25), dark, [1.27, 0.34, 0], [Math.PI / 2, 0, 0]);               // front axle
    add(0, C(0.025, 1.25), dark, [-1.16, 0.34, 0], [Math.PI / 2, 0, 0]);              // rear axle
    // stage 2 — cockpit: dash, console, steering wheel, seat bases
    add(2, B(0.3, 0.12, 1.25), leather, [0.38, 0.86, 0]);
    add(2, B(0.9, 0.18, 0.2), leather, [-0.15, 0.55, 0]);
    add(2, new THREE.TorusGeometry(0.17, 0.018, 12, 32), leather, [0.3, 0.93, -0.36], [0, Math.PI / 2 - 0.45, 0]);
    for (const s of [-1, 1]) add(2, B(0.5, 0.1, 0.42), leather, [-0.3, 0.56, s * 0.36]);
  }

  return root;
}
