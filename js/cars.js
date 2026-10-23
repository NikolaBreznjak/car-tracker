// Car configs. Add a new car by adding an entry to CARS (see README: "Add a car").
// Everything on screen (names, colors, goal, stage thresholds, 3D shape) is driven from here.
//
// `shape.profile` describes the body for the procedural "coupe" builder (metres; +x = front, +y = up, 0 = ground):
//   top    [[x, y] ...]  roof / hood centre-line          belt   [[x, y] ...]  beltline cap (windows start above it)
//   bottom [[x, y] ...]  underside                        width  [[x, halfWidth] ...]
//   wheels { fx, rx, z, r }  front axle x, rear axle x, track half-width, tyre radius
//   humps  front fender humps / hood dip / rear haunch tuning
//   glass  x-ranges of the greenhouse, roof panel, A / B / C pillars, door cut lines, mirrors
//   lights headlight position / shape; layout: engine + cabin x-offsets (mid-engine vs rear-engine)

export const DEFAULT_STAGES = [
  'The foundation',
  'Wheels & brakes',
  'The cabin',
  'Bodywork',
  'Glass & glazing',
  'The finishing touches',
];

// Stage i completes at thresholds[i] (fraction of goal). Equal sixths by default.
const SIXTHS = [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1];


// ---- Porsche-911-style: rear engine, short nose with fender humps, sloped fastback, ducktail ----
const PROFILE_911 = {
  x0: -2.27, x1: 2.27,
  top: [[-2.27, 0.74], [-2.25, 0.86], [-2.2, 0.965], [-2.1, 1.0], [-1.9, 0.975], [-1.55, 1.03], [-1.1, 1.16], [-0.6, 1.27], [-0.25, 1.3], [0.1, 1.26], [0.45, 1.12], [0.8, 0.985], [1.15, 0.9], [1.55, 0.835], [1.9, 0.775], [2.12, 0.7], [2.23, 0.62], [2.27, 0.52]],
  belt: [[-2.3, 0.98], [-1.0, 0.99], [-0.2, 0.95], [0.8, 0.91], [2.3, 0.91]],
  bottom: [[-2.27, 0.46], [-2.2, 0.31], [-2.05, 0.2], [-1.5, 0.15], [1.0, 0.15], [1.85, 0.2], [2.17, 0.29], [2.27, 0.4]],
  width: [[-2.27, 0.1], [-2.25, 0.34], [-2.17, 0.58], [-2.0, 0.74], [-1.75, 0.865], [-1.4, 0.945], [-0.7, 0.95], [0.0, 0.9], [0.6, 0.86], [1.2, 0.875], [1.65, 0.83], [1.95, 0.73], [2.13, 0.55], [2.24, 0.33], [2.27, 0.1]],
  nose: { nTop: 2.15 },                       // section "squareness" at the nose (lower = rounder)
  wheels: { fx: 1.4, rx: -0.95, z: 0.76, r: 0.345 },
  humps: { front: { amp: 0.055, z: 0.58, sig: 0.2, x0: 0.9, x1: 1.35, x2: 2.05, x3: 2.25 }, dip: 0.022, rear: { amp: 0.04, z: 0.72, sig: 0.17, x0: -2.12, x1: -2.0, x2: -1.6, x3: -1.3 } },
  glass: { x0: -1.62, x1: 0.86, roof: [-1.5, 0.28], a: [0.22, 0.84], b: -0.46, c: [-1.6, -1.1], doors: [0.62, -0.46], mirror: 0.64 },
  lights: { x: 1.83, z: 0.6, r: 0.14, sx: 1.0 },
  layout: { engineDX: 0, cabinDX: 0, ducktail: true, sideIntake: false, rearLightBar: true },
};

// ---- Cayman-style: mid-engine, cab-forward dome roof, high rear deck, short tail, side intakes ----
const PROFILE_CAYMAN = {
  x0: -2.2, x1: 2.24,
  top: [[-2.2, 0.82], [-2.18, 0.92], [-2.1, 0.98], [-1.95, 1.0], [-1.7, 1.02], [-1.35, 1.07], [-0.95, 1.16], [-0.5, 1.235], [-0.05, 1.27], [0.3, 1.235], [0.6, 1.12], [0.9, 0.99], [1.2, 0.9], [1.6, 0.82], [1.95, 0.75], [2.12, 0.68], [2.21, 0.6], [2.24, 0.5]],
  belt: [[-2.3, 1.0], [-1.0, 1.0], [-0.2, 0.93], [0.8, 0.89], [2.3, 0.89]],
  bottom: [[-2.2, 0.36], [-2.1, 0.22], [-1.5, 0.15], [1.0, 0.15], [1.9, 0.17], [2.12, 0.24], [2.24, 0.36]],
  width: [[-2.2, 0.1], [-2.18, 0.42], [-2.08, 0.68], [-1.8, 0.88], [-1.3, 0.95], [-0.8, 0.945], [-0.2, 0.88], [0.5, 0.84], [1.1, 0.87], [1.6, 0.85], [1.95, 0.77], [2.12, 0.6], [2.22, 0.38], [2.24, 0.1]],
  nose: { nTop: 2.3 },
  wheels: { fx: 1.45, rx: -1.03, z: 0.77, r: 0.34 },
  humps: { front: { amp: 0.04, z: 0.6, sig: 0.2, x0: 1.0, x1: 1.4, x2: 2.0, x3: 2.2 }, dip: 0.012, rear: { amp: 0.055, z: 0.72, sig: 0.19, x0: -2.05, x1: -1.9, x2: -1.0, x3: -0.75 } },
  glass: { x0: -1.5, x1: 0.88, roof: [-1.35, 0.4], a: [0.34, 0.9], b: -0.3, c: [-1.5, -0.95], doors: [0.55, -0.35], mirror: 0.66 },
  lights: { x: 1.8, z: 0.61, r: 0.13, sx: 1.35 },
  layout: { engineDX: 0.62, cabinDX: 0.28, ducktail: false, sideIntake: true, rearLightBar: false },
};

// ---- real model: "(FREE) Porsche 911 Carrera 4S" by Lionsharp Studios (CC BY-SA 4.0) ----
// stages: stage index -> node names (dots in names are ignored). Meshes not listed go to `defaultStage` (5 = finishing touches).
const GLTF_911 = {
  url: 'assets/models/porsche-911-carrera-4s.glb',
  rotateY: Math.PI / 2,                // model faces +z, the scene faces +x
  hide: ['Plane'],                     // the author's ground plane with the watermark
  hideMaterials: ['coat'],             // tint overlay shells; replaced by real clear-coat on the paint
  paintMaterials: ['paint'],           // repainted with cfg.color + cfg.paint
  glassMaterials: ['window'],          // black panels with the bodywork, real glass at the glass stage
  wheelNodes: ['Cylinder000', 'Cylinder001'],    // one mesh per axle (both wheels) -> split per side at load
  regionNodes: ['boot008', 'boot002', 'boot001', 'boot005', 'boot006'],   // big stage-3 body meshes -> cut into rear / cabin / front panels
  regionCuts: [-0.8, 0.85],                       // car-space x of the two cut planes (rear | cabin | front)
  // assembly: per unit arrival direction (car space: +x front, +y up, +z side), distance (m), order within its stage
  // (low = lands first), optional spin (rad). Units not listed use the per-stage defaults (see js/gltfcar.js).
  assembly: {
    boot: { dir: [-1, 0.2, 0], dist: 2.6, order: 0 },
    boot010: { dir: [0, 1, 0], dist: 1.3, order: 5 },
    underbody: { dir: [0, 1, 0], dist: 1.8, order: 0 },
    Cube002: { dir: [0, 1, 0], dist: 1.4, order: 10 },
    region_rear: { dir: [-1, 0.45, 0], dist: 1.9, order: 10 },
    region_cabin: { dir: [0, 1, 0], dist: 2.1, order: 20 },
    region_front: { dir: [1, 0.4, 0], dist: 1.9, order: 30 },
    glass_windshield: { dir: [0, 1, 0], dist: 0.8, order: 60 },
    glass_boot004: { dir: [0, 1, 0], dist: 0.8, order: 62 },
    glass_window_rear: { dir: [0, 1, 0], dist: 0.8, order: 64 },
    boot009: { dir: [0, 1, 0], dist: 0.35 },
  },
  materialOverrides: { license: { metalness: 0, roughness: 0.55, emissiveFromMap: 0.35 } },   // number plates read as white in the dark studio
  defaultStage: 5,
  stages: {
    0: ['boot', 'boot010'],                                                                         // floor pan, arch liners
    1: ['Cylinder000', 'Cylinder001'],                                                                // wheels, tyres, discs, calipers
    2: ['Cube002', 'underbody'],                                                                                   // seats (+ procedural dash, wheel)
    3: ['boot008', 'boot001', 'boot002', 'boot005', 'Plane002', 'Plane003', 'Plane004', 'boot006', 'window_rear001', 'windshield', 'window_rear', 'boot004'], // panels + (black) glass
    4: ['boot009', 'Cube001'],                                                                        // glazing trim, wipers
    // 5: everything else — lights, grilles, badge, plates, tail-light bar
  },
};
const GLTF_911_CREDIT = {
  text: '3D model: “(FREE) Porsche 911 Carrera 4S” by Lionsharp Studios, CC BY-SA 4.0 (modified: repainted, staged)',
  url: 'https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf',
};

export const CARS = {
  'carrera-4s': {
    id: 'carrera-4s',
    garageNo: '991',
    name: '911 Carrera 4S',
    colorName: 'GT Silver',
    model: 'Porsche 991',
    watermark: '911',
    tagline: 'Then build the Porsche.',
    color: '#b7bcc4',
    goal: 164500,
    label: 'Some revenue',
    stages: DEFAULT_STAGES,
    thresholds: SIXTHS,
    // builder: 'gltf' = real model (see `gltf` below); falls back to the procedural 'coupe' (`shape.profile`) if it fails to load.
    builder: 'gltf',
    gltf: GLTF_911,
    paint: { metalness: 0.9, roughness: 0.3 }, // GT Silver metallic + clear-coat
    shape: { profile: PROFILE_911 }, // procedural fallback body (+ `reflection: false` to skip the floor mirror)
    credit: GLTF_911_CREDIT,
  },
  cayman: {
    id: 'cayman',
    hidden: true, // procedural placeholder (no free licensed Cayman GLB found) — still reachable via ?car=cayman; drop a GLB in + `builder: 'gltf'` to enable

    garageNo: '981',
    name: 'Cayman S',
    colorName: 'Racing Yellow',
    model: 'Porsche 981',
    watermark: '718',
    tagline: 'Then build the Cayman.',
    color: '#ffd000',
    goal: 89400,
    label: 'Some revenue',
    stages: DEFAULT_STAGES,
    // uneven thresholds example: foundation is cheap, finishing touches are pricey
    thresholds: [0.12, 0.3, 0.46, 0.7, 0.85, 1],
    builder: 'coupe',
    paint: { metalness: 0.12, roughness: 0.3 }, // solid-colour gloss
    shape: { profile: PROFILE_CAYMAN },
  },
};

export const DEFAULT_CAR = 'carrera-4s';

export function getCar(id) {
  return CARS[id] || CARS[DEFAULT_CAR];
}
