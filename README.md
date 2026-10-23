# car-tracker — *build the business, then build the Porsche*

A dark, premium revenue tracker. The more revenue you report, the more of a 3D car is assembled — piece by piece, in 6 stages — until the finish line. The default car is a real Porsche 911 Carrera 4S glTF model (see Credits); the Cayman is still a procedural coupe. Zero build step, zero-dependency Node API.

**Live (frontend, demo / `?raised=` / `?api=` modes):** https://nikolabreznjak.github.io/car-tracker/

## Run locally

```bash
API_KEY=changeme node server/index.js        # http://localhost:8080  (Node 18+, no npm install)
# or just static:  python3 -m http.server     # demo + ?raised= + ?api= only
```

## URL params

| param | meaning |
|---|---|
| `?raised=38400` | fixed amount (manual demo), no network |
| `?api=https://host/api/state` | poll this JSON every 10s (`&poll=5` to change, min 3) |
| *(none)* | polls `./api/state`; if unavailable → demo mode (auto-plays 0 → goal once) |
| `?car=carrera-4s` / `cayman` | choose car config |
| `?goal=` `?label=` | override goal / label |
| `?demo=1` (or press **d**) | demo panel: slider, +$ buttons, play 0 → goal (~5s) |
| `?embed=1` | hide header chrome (title, taglines, watermark, car selector) |
| `?az=40&el=12&d=6` | fixed camera (azimuth/elevation/distance) – handy for screenshots |

State JSON: `{ "raised": 38400, "goal": 164500, "car": "carrera-4s", "label": "Some revenue" }` (`goal`/`car`/`label` optional; `?car=` in the URL wins over the API).

## API (`server/index.js`)

Env: `API_KEY` (required for writes), `PORT` (8080), `DATA_FILE` (`./data/state.json`), `CORS_ORIGIN` (`*`), `DEFAULT_GOAL`, `DEFAULT_CAR`, `DEFAULT_LABEL`.

```bash
# read (public, CORS enabled)
curl https://YOUR_HOST/api/state

# add money (a sale!)
curl -X POST https://YOUR_HOST/api/revenue \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"amount": 1500, "note": "Acme annual plan"}'

# negative amount = refund
curl -X POST https://YOUR_HOST/api/revenue -H "Authorization: Bearer $API_KEY" -d '{"amount": -200}'

# set absolute values (any subset of raised, goal, car, label)
curl -X POST https://YOUR_HOST/api/state \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"raised": 38400, "goal": 164500, "car": "cayman", "label": "Acme MRR"}'
```
Writes persist to `DATA_FILE` (with the last 200 events). Without `API_KEY` all writes return 503.

## Embed in your dashboard

```html
<iframe src="https://YOUR_HOST/?embed=1&api=https://YOUR_HOST/api/state"
        style="width:100%;height:640px;border:0;border-radius:16px" loading="lazy"></iframe>
```
Using the GitHub Pages frontend with your own backend: `https://nikolabreznjak.github.io/car-tracker/?embed=1&api=https://YOUR_HOST/api/state` (CORS is open). To make that the default, set `DEFAULT_API` in `js/config.js`.

From your own dashboard backend, push revenue whenever it changes (e.g. nightly cron: `POST /api/state {"raised": <total MRR/revenue>}`) or on each sale (`POST /api/revenue`).

## Deploy the backend + frontend together

* **Render**: New → Blueprint → select this repo (`render.yaml`). `API_KEY` is generated for you (Environment tab). Free tier has an ephemeral disk (total resets on restart) — use the starter plan + disk for persistence, or just re-`POST /api/state` from your dashboard on a schedule (recommended anyway).
* **Fly.io**: see the header of `fly.toml` (volume-backed, persistent).
* **Docker anywhere**: `docker build -t car-tracker . && docker run -p 8080:8080 -e API_KEY=secret -v ctdata:/data car-tracker`.

## Add a car

Open `js/cars.js` and add an entry:

```js
'my-car': {
  id: 'my-car', garageNo: '001', name: 'My Car', colorName: 'Midnight', model: 'Brand Model',
  watermark: 'MC', tagline: 'Then build the dream.',
  color: '#1c2a4a', goal: 120000, label: 'Some revenue',
  stages: DEFAULT_STAGES,                       // 6 names, override freely
  thresholds: [0.1, 0.25, 0.45, 0.7, 0.85, 1], // stage i completes at this fraction of goal
  builder: 'coupe',                             // built-in procedural coupe … (or 'gltf' for a real model, see below)
  paint: { metalness: 0.2, roughness: 0.3 },   // optional: metallic (silver) vs solid-colour gloss
  shape: { profile: MY_PROFILE },               // … with its own silhouette (see below); optional `scale: [sx, sy, sz]`
},
```

### Real glTF/GLB models

`builder: 'gltf'` + a `gltf` block (see `GLTF_911` in `js/cars.js`) loads a GLB from `assets/models/` (Draco-compressed GLBs work; the decoder is vendored in `vendor/addons/libs/draco/`, no CDN). Stage mapping is by node name:

```js
gltf: {
  url: 'assets/models/my-car.glb',
  rotateY: Math.PI / 2,             // rotate so the nose points to +x
  hide: ['Plane'],                  // nodes to drop (ground planes, watermarks)
  hideMaterials: ['coat'],          // materials whose meshes to drop
  paintMaterials: ['paint'],        // these get the car's `color` + `paint` as clear-coated metallic paint
  glassMaterials: ['window'],       // black opaque with the bodywork, real glass at the glass stage
  wheelNodes: ['Cylinder000', 'Cylinder001'],   // for the tyre contact shadows
  stages: { 0: ['floor'], 1: ['wheels_front', 'wheels_rear'], 2: ['seats'], 3: ['body'], 4: ['trim'] }, // rest → stage 5
}
```
Find node names with `console.log(__car)` in the dev console (or `gltf-transform inspect`). Un-built stages show as a lime x-ray hologram; a scan front sweeps rear → front as a stage fills. If the model fails to load, the car falls back to the procedural coupe in `shape.profile`. Credits for a model go in the car's `credit: { text, url }` (shown in the page footer).

## Credits

* **911 Carrera 4S model** — [“(FREE) Porsche 911 Carrera 4S”](https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf) by **Lionsharp Studios**, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Source file: [playcanvas/web-components](https://github.com/playcanvas/web-components/tree/main/examples/assets/models) (`porsche-911-carrera-4s.glb`, unmodified file; repainted, hidden-ground-plane and per-stage staging happen at runtime in `js/gltfcar.js`). Because of ShareAlike, anything derived from that model file must stay under CC BY-SA 4.0.
* **three.js** (MIT) and its GLTFLoader / DRACOLoader, **Draco** decoder (Apache-2.0) are vendored under `vendor/`.
* Porsche, 911, Cayman and the crest are trademarks of Dr. Ing. h.c. F. Porsche AG; this is an unofficial fan project.
`MY_PROFILE` is a plain object of point arrays (side-view roof/belt/underside lines, plan-view width, wheel positions, fender humps, greenhouse x-ranges, headlight, engine/cabin layout). Copy `PROFILE_911` (rear-engine, ducktail) or `PROFILE_CAYMAN` (mid-engine, dome roof, side intakes) from `js/cars.js` and tweak — a new silhouette needs no builder changes. Set `shape.reflection: false` to drop the faint floor reflection (saves ~half the triangles on weak GPUs).
Then open `?car=my-car` (or `POST /api/state {"car":"my-car"}`). To use a totally different model, set `builder` to a function `(cfg, renderer) => THREE.Object3D` that returns an object with `userData.setProgress(levels)` where `levels` is an array of 6 numbers 0..1 (stage progress) — see `buildCoupe` in `js/carbuilder.js` for the pattern. (Loading a glTF this way means fading its meshes per stage by name.)

## Notes / limits

* The 911 is a real (CC BY-SA) 3D model of a Porsche 911 Carrera 4S (991 generation); the engine bay/dash/steering wheel you see during the build are simple procedural stand-ins because the model has no drivetrain/cockpit. The Cayman is still the stylised procedural coupe (no freely downloadable Cayman model was available — see README "Add a car" to drop in your own GLB).
* Single-total model: one `raised` number. No per-product history UI (events are logged server-side only).
* GitHub Pages is static: `POST` endpoints need the Node backend somewhere.
* Needs WebGL; three.js is vendored (`vendor/`, MIT) so there are no CDN dependencies.
