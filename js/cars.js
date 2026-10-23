// Car configs. Add a new car by adding an entry to CARS (see README: "Add a car").
// Everything on screen (names, colors, goal, stage thresholds, 3D shape) is driven from here.

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
    shape: {}, // optional overrides: { scale:[sx,sy,sz], ... }
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
    shape: { scale: [0.96, 0.95, 0.98] },
  },
};

export const DEFAULT_CAR = 'carrera-4s';

export function getCar(id) {
  return CARS[id] || CARS[DEFAULT_CAR];
}
