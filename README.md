# car-tracker — *build the business, then build the Porsche*

A dark, premium revenue tracker. The more revenue you report, the more of a 3D car is assembled — piece by piece, in 6 stages — until the finish line. Cars: a real Porsche 911 Carrera 4S glTF model (default) and a real BMW M3 Competition (G80, 2021) glTF model and a real Ferrari F40 glTF model (see Credits); the Cayman is still a procedural coupe (hidden). The Range Rover Velar HSE is not included (no freely downloadable licensed model — see *Adding the Velar*). Zero build step, zero-dependency Node API.

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
| `?car=carrera-4s` / `m3-g80` / `f40` / `cayman` | choose car config. Goals: 911 $164,500 · M3 Competition $72,000 (≈ 2021 US base MSRP) · Ferrari F40 $400,000 (≈ US launch price) · override with `?goal=` |
| `?goal=` `?label=` | override goal / label |
| `?demo=1` (or press **d**) | demo panel: slider, +$ buttons, play 0 → goal (~5s) |
| `?embed=1` | hide header chrome (title, taglines, watermark, car selector). Dragging is **off** in embeds … |
| `?drag=1` | … unless you add this (`?embed=1&drag=1`) |
| `?az=40&el=12&d=6` | fixed camera (azimuth/elevation/distance) – handy for screenshots |

State JSON: `{ "raised": 38400, "goal": 164500, "car": "carrera-4s", "label": "Some revenue" }` (`goal`/`car`/`label` optional; `?car=` in the URL wins over the API).

## Drag the amount (try it with your hands)

The amount is interactive — handy for demos, and for seeing how the car looks at any revenue. Nothing is ever POSTed to the API.

* **Big dollar number**: grab it and drag **right / up** to add, **left / down** to subtract (≈ a third of the screen width = 0 → 100 %). Cursor is `ew-resize`; a small `◂ drag ▸` hint shows on hover and for a few seconds after load. **Shift** while dragging snaps to a round step (~1 % of the goal, $1,000 for the 911); **Alt** = fine (10×).
* **Progress bar**: click anywhere on it, or drag along it (a thumb appears). Shift snaps here too.
* **Keyboard** (number or bar focused): ←/↓ −$100, →/↑ +$100, Shift+arrows ±$1,000, PageUp/PageDown ±$5,000, Home / End = 0 / goal.
* Works with mouse, pen and touch (pointer events, `touch-action: none` on the controls). On phones the car stays pinned at the top while you drag the number below it.
* Everything follows at frame rate: counter, % funded, bar, "to the finish line", assembly n / 6, the checklist and the 3D car. Values clamp to 0 … goal.
* **Live data vs manual:** while dragging, and for 15 s after, API polling is paused (the latest API value is remembered) and a **manual — reset** chip appears; click it to jump back to the live value. After 15 s with an API configured, live data takes over again by itself. With no API (`?raised=` / demo) the manual value just stays until you reset.

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
Find node names with `console.log(__car)` in the dev console (or `gltf-transform inspect`). Un-built stages show as a lime x-ray hologram ("blueprint"); see *Assembly sequence* below for how parts arrive. If the model fails to load, the car falls back to the procedural coupe in `shape.profile`. Credits for a model go in the car's `credit: { text, url }` (shown in the page footer).

### Adding the Velar (Range Rover Velar HSE, L560)

No Velar glTF with a redistributable licence could be downloaded without an account, so there is no Velar entry any more (the Ferrari F40 took its place in the selector). If you supply a file: add a `velar-hse` entry to `CARS` in `js/cars.js` (goal ≈ $70,000, Santorini Black `#15181c`). Candidates (all need a free Sketchfab login to hit *Download 3D model → glTF*):

| model | author | licence | triangles |
|---|---|---|---|
| [Land Rover Range Rover Velar](https://sketchfab.com/3d-models/land-rover-range-rover-velar-494c03e056674423a8ca2e2af0c01eef) | Mona x Supercars | CC BY | 26.5k |
| [Land Rover Range Rover Velar R Dynamic](https://sketchfab.com/3d-models/land-rover-range-rover-velar-r-dynamic-189457c720584735bcc9059d14b5a3fd) | Ciiplix | CC BY | 17.4k |
| [2018 Range Rover Velar First Edition](https://sketchfab.com/3d-models/2018-range-rover-velar-first-edition-4a6ca37f18c04bbb97e60601200c3a6b) | Nazh Design | CC BY | 4.1M (needs decimating) |

Paid (no licence worries, GLB included): [88Cars3D Velar, €8](https://88cars3d.com/product/land-rover-range-rover-velar-mid-size-luxury-suv-3d-model/).

Wiring it in takes a few minutes: `node tools/bake-model.mjs download/scene.gltf baked.glb 4.80 <rotY>` → `gltf-transform optimize …` (commands in the tool's header) → `assets/models/range-rover-velar.glb`, then copy the `GLTF_M3` block in `js/cars.js`, list the node names per stage (`node tools/inspect-model.mjs baked.glb` lists nodes, bboxes, materials), set `builder: 'gltf'`, add the attribution above. (A car entry with `soon: true` shows greyed-out in the selector and is never loaded — handy as a placeholder.)

### Assembly sequence

Every part's pose is a **pure function of the six stage levels** (derived from the raised amount) — there are no timers or event history, so the build can be scrubbed forwards and backwards, dragged, or jumped to any amount and always shows the right thing (`js/gltfcar.js`).

* The model is grouped into **units** (a wheel, a body panel region, the seats, the front fascia, mirrors, each glass pane …). Inside a stage each unit gets its own delay (rear → front by default, or `assembly.<unit>.order`), then a local progress `u`:
  * `u > 0` — a lime hologram of the part appears at its start offset and **flies in from its natural direction** with an ease-out-back (slight overshoot, then settle): wheels from the sides (spinning down), chassis parts from behind, seats / roof from above, bumpers & trim from outside;
  * the real PBR material **sweeps in over the hologram** with a glowing lime front, then
  * on **lock-in** the part's rim and cut edges flash lime and a burst of **sparks** flies off, while the static blueprint at its final place fades out.
* The big body meshes are cut into **rear / cabin / front panels** with a clip plane in the shader (`regionNodes`, `regionCuts`), the two-wheels-in-one-mesh axles are split per side at load.
* Glass is black with the bodywork, then turns into real glass at stage 5; lamps glow on in the last stage. **Every part has landed by 70 % of its stage**, so the car is a solid silver body with black windows at 62 % and fully finished (+ banner) at 100 %.
* A **subtle camera nudge** per stage (low on the chassis → wheels → cabin → pull back for the panels → windshield → full car) is applied on top of your own orbit / zoom.
* Per-car tuning in `js/cars.js` → `gltf.assembly` (`dir`, `dist`, `order`, `spin`, per unit key), `regionNodes`, `regionCuts`, `stageDefaults`. The procedural fallback car (used if the GLB fails to load, and for the Cayman) keeps its own simpler fade/settle build.

## Credits

* **911 Carrera 4S model** — [“(FREE) Porsche 911 Carrera 4S”](https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf) by **Lionsharp Studios**, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Source file: [playcanvas/web-components](https://github.com/playcanvas/web-components/tree/main/examples/assets/models) (`porsche-911-carrera-4s.glb`, unmodified file; repainted, hidden-ground-plane and per-stage staging happen at runtime in `js/gltfcar.js`). Because of ShareAlike, anything derived from that model file must stay under CC BY-SA 4.0.
* **M3 Competition model** — [“2021 BMW M3 Competition”](https://sketchfab.com/3d-models/2021-bmw-m3-competition-a9027a26b7ee4da4b564d939b6c27559) (BMW G80, 415k triangles) by **supercarmodels** (Sketchfab account now shown as *DisneyCars*), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — commercial use allowed with credit. Source file: [Holding-1-at-a-time/ai-scheduler](https://github.com/Holding-1-at-a-time/ai-scheduler/tree/main/public/2021-BMW-M3) (`scene.gltf` + textures + the author's `license.txt`, which carries the licence text above). Modified: baked to 4.794 m / nose +x with `tools/bake-model.mjs`, textures downsized to 1024 px WebP, Draco-compressed (`assets/models/bmw-m3-g80.glb`, 6 MB), number plates hidden, repainted at runtime (Isle of Man Green), split into build stages in `js/gltfcar.js`.
* **Ferrari F40 model** — [“Ferrari F40”](https://sketchfab.com/3d-models/ferrari-f40-52a66c41cfcd4f999fb1b1c49bf24d70) (245k triangles) by **Black Snow**, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (verified through the Sketchfab API: “CC Attribution”) — commercial use allowed with credit. Source file: the licence-tracked mirror in [sceneview/sceneview](https://github.com/sceneview/sceneview) (`assets/catalog.json` → `ferrari_f40`, CC-BY-4.0; release asset `assets-v1/a1ec281f…3674`, 8.1 MB). Modified: baked to 4.358 m / nose +x with `tools/bake-model.mjs`, textures downsized to 1024 px WebP, Draco-compressed (`assets/models/ferrari-f40.glb`, 0.8 MB), repainted at runtime (Rosso Corsa), split into build stages in `js/gltfcar.js`.
* **three.js** (MIT) and its GLTFLoader / DRACOLoader, **Draco** decoder (Apache-2.0) are vendored under `vendor/`.
* Porsche, 911, Cayman and the crest are trademarks of Dr. Ing. h.c. F. Porsche AG; BMW and M3 are trademarks of BMW AG; Ferrari and F40 are trademarks of Ferrari S.p.A.; Range Rover and Velar are trademarks of Jaguar Land Rover. This is an unofficial fan project.
`MY_PROFILE` is a plain object of point arrays (side-view roof/belt/underside lines, plan-view width, wheel positions, fender humps, greenhouse x-ranges, headlight, engine/cabin layout). Copy `PROFILE_911` (rear-engine, ducktail) or `PROFILE_CAYMAN` (mid-engine, dome roof, side intakes) from `js/cars.js` and tweak — a new silhouette needs no builder changes. Set `shape.reflection: false` to drop the faint floor reflection (saves ~half the triangles on weak GPUs).
Then open `?car=my-car` (or `POST /api/state {"car":"my-car"}`). To use a totally different model, set `builder` to a function `(cfg, renderer) => THREE.Object3D` that returns an object with `userData.setProgress(levels)` where `levels` is an array of 6 numbers 0..1 (stage progress) — see `buildCoupe` in `js/carbuilder.js` for the pattern. (Loading a glTF this way means fading its meshes per stage by name.)

## Notes / limits

* The M3 is a real CC BY 3D model of a 2021 BMW M3 Competition (G80); the engine bay, cockpit and underbody you see during the build come from the model itself (the paint is one material split over 16 meshes, so the shell is revealed as rear / cabin / front regions). The 911 is a real (CC BY-SA) 3D model of a Porsche 911 Carrera 4S (991 generation); the engine bay/dash/steering wheel you see during the build are simple procedural stand-ins because the model has no drivetrain/cockpit. The Cayman is still the stylised procedural coupe (no freely downloadable Cayman model was available — see README "Add a car" to drop in your own GLB).
* Single-total model: one `raised` number. No per-product history UI (events are logged server-side only).
* GitHub Pages is static: `POST` endpoints need the Node backend somewhere.
* Assembly timing is in stage units, so cars with very uneven `thresholds` get proportionally quicker / slower flights. Sparks and holograms are cheap but add draw calls (≈ 3 per model part); on weak GPUs set `shape.reflection: false`.
* Needs WebGL; three.js is vendored (`vendor/`, MIT) so there are no CDN dependencies.

## Changelog (v5)

* **Fix — two pipes sticking out of the 911's rear.** They were the procedural stand-in exhaust tailpipes. The stand-ins were placed relative to the model's bounding box, and that box was too long at the rear (`Box3.setFromObject` over-estimates rotated meshes: the rear panel `Plane002` reported x = −2.55 m instead of −2.11 m), so the pipes ended 0.24 m behind the bumper. The tight bounds now come from the vertices each piece really uses (`preciseBox` in `js/gltfcar.js`) and the stand-in exhausts are gone (the model has its own tailpipes). The same bounds fix tightens the framing/shadows of the other cars. At 100 % every unit has zero offset/spin (checked for all cars).
* **New car — Ferrari F40** (`?car=f40`, replaces the greyed-out Velar placeholder).
