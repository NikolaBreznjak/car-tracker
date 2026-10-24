# car-tracker — *build the business, then build the Porsche*

A dark, premium revenue tracker. The more revenue you report, the more of a real 3D car is assembled — piece by piece, in 6 stages — until the finish line. Cars: Porsche 911 Carrera 4S (default), BMW M3 Competition (G80, 2021) and Ferrari F40, all real glTF models (see Credits). Static site + GitHub Actions "API", zero build step; an optional zero-dependency Node server is included as an alternative.

**Live:** https://nikolabreznjak.github.io/car-tracker/ · per-goal: `…/?goal=<id>` · embed: `…/?embed=1`

## Revenue API (GitHub-native, no extra accounts)

Your dashboard calls GitHub's [`repository_dispatch`](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event) endpoint. The workflow [`.github/workflows/revenue.yml`](.github/workflows/revenue.yml) validates the payload, updates the JSON files in [`data/`](data/), commits them to `main` and triggers [`pages.yml`](.github/workflows/pages.yml), which redeploys the site. The page polls `data/goals/<goal>.json` every 30 s.

```
dashboard ──POST /repos/NikolaBreznjak/car-tracker/dispatches──▶ revenue.yml (validate → data/*.json → commit to main)
                                                                     └─▶ pages.yml (deploy) ──▶ page polls data/goals/<id>.json?t=… every 30 s
```

### Add money (a sale)

```bash
curl -X POST https://api.github.com/repos/NikolaBreznjak/car-tracker/dispatches \
  -H "Authorization: Bearer $CAR_TRACKER_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{"event_type":"add-revenue","client_payload":{"goal":"default","amount":1500,"note":"Acme plan"}}'
```

GitHub answers `204 No Content` when the event is accepted (validation happens in the workflow — check the *Actions* tab if a value doesn't show up). Negative `amount` = refund (the total never goes below 0).

### Set absolute values

```bash
curl -X POST https://api.github.com/repos/NikolaBreznjak/car-tracker/dispatches \
  -H "Authorization: Bearer $CAR_TRACKER_TOKEN" -H "Accept: application/vnd.github+json" \
  -d '{"event_type":"set-state","client_payload":{"goal":"default","raised":38400,"target":164500,"car":"carrera-4s","label":"Acme MRR"}}'
```

Recommended for dashboards: send `set-state {"raised": <current total>}` on a schedule (e.g. hourly) — it is idempotent, so a lost or duplicated event can never drift the total. Use `add-revenue` for live "a sale just happened" moments.

| field | event | rules |
|---|---|---|
| `goal` | both | tracker id, `[a-z0-9-]{1,40}`, default `default`. A new id creates a new tracker (max 100). |
| `amount` | add-revenue | number (or numeric string), ≠ 0, \|amount\| ≤ 1e9, rounded to cents |
| `note` | both | optional, ≤ 140 chars (control characters stripped) — shown in the "recent" list |
| `id` | both | optional idempotency key `[A-Za-z0-9._:-]{1,64}` (e.g. your invoice id): an event whose id is already in the history is skipped, so retries are safe |
| `ts` | both | optional ISO timestamp for back-filling (default: now) |
| `raised` | set-state | absolute total ≥ 0 |
| `target` | set-state | goal amount > 0, or `null` = the car's price |
| `car` | set-state (or add-revenue on a new goal) | `carrera-4s`, `m3-g80`, `f40` (unknown ids fall back to the 911) |
| `label` | set-state (or add-revenue on a new goal) | ≤ 60 chars, shown above the amount |
| `demo` | set-state | `true` = the page plays the 0 → 100 % demo instead of showing the stored value (the `default` goal ships like this). Any real event switches it off. |
| `reset` | set-state | `true` = clear the history (combine with `raised` to restart from a value) |

GitHub limits `client_payload` to 10 top-level keys and 64 KB.

### The token (fine-grained PAT, this repo only)

`repository_dispatch` with a fine-grained personal access token needs **Repository permissions → Contents: Read and write** (verified in GitHub's [permissions table](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens): `POST /repos/{owner}/{repo}/dispatches` → Contents: write; *Metadata: read* is added automatically).

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token** (https://github.com/settings/personal-access-tokens/new).
2. Name `car-tracker dashboard`, expiration as you like (max 1 year — put a reminder in your calendar).
3. **Repository access → Only select repositories → `NikolaBreznjak/car-tracker`.**
4. **Repository permissions → Contents → Read and write.** Nothing else.
5. Generate, copy it once, store it as a secret in your dashboard (`CAR_TRACKER_TOKEN`). Never put it in front-end code or in this repo.

Note that Contents: write on this repo also lets the token push code to it — keep it server-side. You can also trigger events by hand: *Actions → revenue → Run workflow* (form inputs), or `gh workflow run revenue.yml -f event=add-revenue -f amount=1500 -f note="Acme plan"`.

### Latency (honest numbers)

A pushed amount shows up on the live page in roughly **1–2 minutes**: workflow start + commit ≈ 15–30 s, Pages deploy ≈ 30–60 s, then up to 30 s until the page's next poll. The page fetches `data/goals/<id>.json?t=<now>` (the query string bypasses the Pages CDN cache of ~10 min). Bursts are fine: every run commits optimistically and retries on a non-fast-forward push (no events are dropped — a `concurrency:` group was avoided on purpose because GitHub cancels all but one pending run), and `pages.yml` runs in a `pages` concurrency group, so a burst collapses into one running + one pending deploy (batching).

### ⚠️ The data is public

This repo is **public**, so `data/goals/*.json` and `data/history/*.json` — totals, notes, timestamps — are readable by anyone (on GitHub and on the Pages site). Don't put customer names or anything sensitive in `note`. Options if that's a problem:
* make the repo **private** — GitHub Pages on a private repo needs a paid plan (Pro/Team);
* or use percentages / rounded numbers;
* or run the Node server below on a host of your choice (state stays on the server; `GET /api/state` is still public but nothing is in git).

### Files

| file | content |
|---|---|
| `data/goals/<id>.json` | `{ id, label, car, goal, raised, demo?, updatedAt, events }` (`goal` = target amount, `null` = car price) |
| `data/history/<id>.json` | `{ id, events: [{ ts, type: "add"\|"set", amount?, note?, raised, id? }] }` — last 1000 events, oldest first |
| `data/index.json` | list of all goals (used by the embed builder) |
| `data/state.json` | copy of the `default` goal |
| `.github/scripts/revenue.mjs` | the validation / apply logic (also runnable locally: `EVENT=add-revenue PAYLOAD='{"amount":5}' node .github/scripts/revenue.mjs`) |

### Alternative: the Node server (`server/index.js`)

Zero-dependency, Node 18+. Env: `API_KEY` (required for writes), `PORT` (8080), `DATA_FILE` (`./data/server-state.json`), `CORS_ORIGIN` (`*`), `DEFAULT_GOAL`, `DEFAULT_CAR`, `DEFAULT_LABEL`. Point the page at it with `?api=https://YOUR_HOST/api/state` (or `DEFAULT_API` in `js/config.js`).

```bash
API_KEY=changeme node server/index.js        # http://localhost:8080
curl https://YOUR_HOST/api/state             # {raised, goal?, car, label, updatedAt, history:[…]}  (public, CORS)
curl -X POST https://YOUR_HOST/api/revenue -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"amount": 1500, "note": "Acme annual plan"}'
curl -X POST https://YOUR_HOST/api/state   -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"raised": 38400, "goal": 164500, "car": "m3-g80", "label": "Acme MRR"}'
```
Deploy: **Render** (New → Blueprint → this repo, `render.yaml`; free tier forgets the total on restart — re-POST `/api/state` on a schedule), **Fly.io** (`fly.toml`, volume-backed), or Docker anywhere (`docker run -p 8080:8080 -e API_KEY=secret -v ctdata:/data car-tracker`). The Node server is single-goal.

## Embed in your dashboard

Click **`</>` Embed** (left column) to pick a goal, a car and toggles (drag, header, chart) and copy the iframe or the direct link. By hand:

```html
<iframe src="https://nikolabreznjak.github.io/car-tracker/?goal=default&embed=1"
        title="Revenue tracker" style="width:100%;height:640px;border:0;border-radius:16px;background:#111" loading="lazy"></iframe>
```
Rendering pauses while the iframe is scrolled out of view or the tab is hidden.

## URL params

| param | meaning |
|---|---|
| `?goal=<id>` | which tracker (`data/goals/<id>.json`), default `default`. The goal's `car` / `label` / `goal` amount apply unless overridden below. (A numeric `?goal=164500` still works as the old goal-amount override.) |
| `?car=carrera-4s` / `m3-g80` / `f40` / `cayman` | force a car. Default prices: 911 $164,500 · M3 Competition $72,000 · F40 $400,000 |
| `?target=` `?label=` | override goal amount / label |
| `?raised=38400` | fixed amount, no network |
| `?api=https://host/api/state` | read from the Node server instead (`&poll=5` = seconds, default 10) |
| `?poll=` | polling interval in seconds (default 30 for the GitHub data) |
| `?embed=1` | hide header chrome (title, watermark, car selector, Embed button) |
| `&drag=1` · `&header=1` · `&chart=0` | in embeds: allow dragging · show the header · hide chart + recent list |
| `?lowpower=1` / `?lowpower=0` | force low-power mode / never switch automatically |
| `?demo=1` (or press **d**) | demo panel: slider, +$ buttons, play 0 → goal |
| `?az=40&el=12&d=6` | fixed camera (azimuth/elevation/distance) – handy for screenshots |

## What's on screen

* **Revenue history** (under the bar): a lime step-area chart of cumulative revenue over time (dashed line = goal), plus the last 5 entries (amount, note, relative time). Hidden until the goal has history; `?chart=0` hides it.
* **Milestone toasts**: when a stage completes ("Wheels & brakes locked in · 2 / 6"). Not shown for the initial count-up to the stored value.
* **Headlights / taillights** light up as the finishing touches lock in (additive overlays + halo sprites per lamp, configured per car in `cars.js → gltf.lamps`; they only glow towards the outside, so you never see a lamp through the cabin from the other end).
* **Performance**: only the selected car's GLB is downloaded (the page waits for the goal's data before picking the model), the previous model's geometries/materials/textures are disposed on switch, rendering pauses when hidden/offscreen, and **low-power mode** (no floor reflection, no sparks, pixel ratio 1) switches on automatically on phones/tablets or when frame time stays above 25 ms for 3 s (`Low-power mode` appears under the orbit hints).

## Run locally

```bash
python3 -m http.server     # http://localhost:8000 — reads data/ like the live site
# or: API_KEY=changeme node server/index.js  and open http://localhost:8080/?api=/api/state
```

## Drag the amount (try it with your hands)

The amount is interactive — handy for demos, and for seeing how the car looks at any revenue. Nothing is ever sent anywhere.

* **Big dollar number**: grab it and drag **right / up** to add, **left / down** to subtract (≈ a third of the screen width = 0 → 100 %). **Shift** snaps to ~1 % of the goal ($1,000 for the 911); **Alt** = fine (10×).
* **Progress bar**: click anywhere on it, or drag along it. Shift snaps here too.
* **Keyboard** (number or bar focused): ←/↓ −$100, →/↑ +$100, Shift+arrows ±$1,000, PageUp/PageDown ±$5,000, Home / End = 0 / goal.
* Works with mouse, pen and touch. On phones the car stays pinned at the top while you drag the number below it.
* **Live data vs manual:** while dragging, and for 15 s after, live updates are paused and a **manual — reset** chip appears; click it to jump back to the live value.

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
* Revenue data lives in this public repo (see *The data is public*). Updates take ~1–2 min to show (Actions + Pages deploy + 30 s poll).
* The workflow files need a token with the `workflow` scope to be pushed/changed; the dashboard token only needs Contents: write.
* Assembly timing is in stage units, so cars with very uneven `thresholds` get proportionally quicker / slower flights. Sparks and holograms are cheap but add draw calls (≈ 3 per model part); on weak GPUs set `shape.reflection: false`.
* Needs WebGL; three.js is vendored (`vendor/`, MIT) so there are no CDN dependencies.

## Changelog (v6)

* **Revenue API on GitHub** — `repository_dispatch` → `revenue.yml` (validation, optimistic commit + retry, no lost events) → `data/*.json` → `pages.yml` deploy (batched). Multiple goals (`?goal=<id>`), idempotency keys, back-fill timestamps, demo flag.
* **History & milestones** — sparkline + recent list under the bar, toasts when a stage completes.
* **Embed builder** — `</> Embed` panel (goal, car, drag/header/chart toggles, iframe + link, copy).
* **Performance** — lazy model selection, dispose on switch, automatic / `?lowpower=1` low-power mode, pause when hidden or offscreen.
* **Polish** — head/tail-light glow at the finishing stage (911, M3, F40), M3 seats + door cards tinted to black leather, og:image / Twitter card (`social/og.png`), SVG + PNG favicons, the floor no longer shows the canvas edge as a box.

## Changelog (v5)

* **Fix — two pipes sticking out of the 911's rear.** They were the procedural stand-in exhaust tailpipes. The stand-ins were placed relative to the model's bounding box, and that box was too long at the rear (`Box3.setFromObject` over-estimates rotated meshes: the rear panel `Plane002` reported x = −2.55 m instead of −2.11 m), so the pipes ended 0.24 m behind the bumper. The tight bounds now come from the vertices each piece really uses (`preciseBox` in `js/gltfcar.js`) and the stand-in exhausts are gone (the model has its own tailpipes). The same bounds fix tightens the framing/shadows of the other cars. At 100 % every unit has zero offset/spin (checked for all cars).
* **New car — Ferrari F40** (`?car=f40`, replaces the greyed-out Velar placeholder).
