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

export const CARS = {
  'carrera-4s': {
    id: 'carrera-4s',
    garageNo: '997',
    name: '911 Carrera 4S',
    colorName: 'GT Silver',
    model: 'Porsche 997',
    watermark: '911',
    tagline: 'Then build the Porsche.',
    color: '#b7bcc4',
    goal: 164500,
    label: 'Some revenue',
    stages: DEFAULT_STAGES,
    thresholds: SIXTHS,
    // builder: 'coupe' = built-in procedural 911-style coupe (three.js primitives).
    builder: 'coupe',
    // gltf: 'models/my-car.glb',   // optional: load a glTF instead (see README)
    paint: { metalness: 0.62, roughness: 0.34 }, // metallic silver
    shape: { profile: PROFILE_911 }, // optional overrides: { scale:[sx,sy,sz], ... }
  },
  cayman: {
    id: 'cayman',
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
