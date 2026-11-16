# APEX GP — Time Trial

A single-player, browser-based Formula-style time-trial game: one car, one
fictional circuit (Circuito Costa Verde, 3.117 km), one mode. Built with
React, Vite, TypeScript, Three.js / React Three Fiber, Rapier and the Web
Audio API. No installation is needed to play the built version.

- Source: this folder (`apex-gp-src/`)
- Production build: `../apex-gp/` (static files, committed so GitHub Pages can
  serve it at `/apex-gp/`)

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate |
| S / ↓ | Brake; reverse once stopped |
| A D / ← → | Steer (smoothed, speed-sensitive) |
| Space | Hard braking |
| C | Cycle camera: chase → cockpit → nose |
| R | Reset the car onto the track (invalidates the current lap) |
| Esc | Pause / resume |

### Phones and tablets (touch)

On a touch device the game shows on-screen controls and plays in landscape:

| Control | Action |
| --- | --- |
| Left pad | Slide left / right to steer (analogue) |
| Right pedals | Brake (left) and accelerator (right); holding brake when stopped reverses |
| Top buttons | Pause, change camera, reset to track |

Every control tracks its own finger, so steering, accelerator and brake can be
held together. Holding the phone upright pauses the game and asks you to
rotate. The layout scales to the screen and respects notch safe areas.
Phones start on the Low preset, and every preset uses tighter budgets on
touch devices (lower resolution ceiling, smaller shadow maps, sparser
scenery); raise it from the menu if your phone copes. On iPhone the ring/silent
switch also mutes game audio, and Safari cannot hide its toolbar from a web
page, so use "Add to Home Screen" for a full-screen view.

## Run locally

Requires Node 18+.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (http://localhost:5173 by default).

## Production build and deployment

```bash
npm run build
```

This type-checks and writes a fully static site to `../apex-gp/`. The build
uses relative URLs, so the folder can be hosted from any path:

- **GitHub Pages (this repository):** commit `apex-gp/`; once it is on the
  branch Pages publishes, the game is at
  `https://<user>.github.io/apex-gp/`.
- **Any static host (Netlify, Vercel, S3, nginx):** upload the contents of
  `apex-gp/`.
- **Local check of the built files:** `npm run preview`.

To build somewhere else, change `build.outDir` in `vite.config.ts`.

## Tests

```bash
npm run test:sim
```

Runs the vehicle physics, barrier collisions, an autopilot driving two full
laps, the lap-validity rules and a 30 fps vs 144 fps determinism check
headlessly in Node (no browser needed). Adding `?autopilot` to the game URL
lets the same test driver lap the circuit in the browser.

## What is implemented

**Driving model** (`src/game/vehicle/vehiclePhysics.ts`) — a simcade
single-track model on a Rapier rigid body, stepped at a fixed 120 Hz and
interpolated for rendering, so behaviour does not depend on frame rate.
Pacejka-style tyre curves with a friction circle (progressive loss of grip,
power oversteer, lock-ups), longitudinal load transfer, downforce and drag
proportional to speed squared, a power-limited 8-speed drivetrain with
automatic shifting and an RPM model, mild traction control / ABS, per-wheel
surface detection (asphalt, kerb, grass, gravel) with grip and drag
penalties, and Rapier collision response against the barriers.

Reference numbers from the test run: 0–100 km/h in 2.4 s, 0–200 in 4.5 s,
about 300–340 km/h at the end of the main straight, roughly 4 g peak lateral.
It is tuned to be fun and believable, not to be an engineering simulator.

**Circuit** (`src/game/track/`) — closed spline with a 900 m start straight,
a 28 m-radius hairpin, fast sweepers and an S-curve section. Kerbs, edge
lines, grid, gravel traps, concrete and tyre barriers, debris fencing,
grandstands, pit lane and pit building, race-control tower, start gantry with
working lights, sponsor boards, a bridge, braking boards, trees and hills.
The collision walls are generated from the same data as the visuals. The
circuit is flat.

**Time trial** (`src/game/timing/lapTimer.ts`) — five-light start, timing from
the first crossing of the line, 10 ordered checkpoints, sub-step interpolated
lap times, live delta to your best at each checkpoint, and the best lap saved
in LocalStorage. A lap is not recorded if a checkpoint is missed or the line
is crossed backwards, and it is marked invalid (and cannot become the best)
if all four wheels leave the track or the car is reset.

**Cameras** (`src/game/camera/CameraRig.tsx`) — chase, cockpit and nose, with
blended transitions, speed-dependent field of view, braking/steering response
on the chase camera and restrained shake.

**Graphics** — PBR materials throughout, HDRI image-based lighting with the
sun direction derived from the HDRI, a shadow-casting sun whose shadow
frustum follows the car, analytic sky with a cloud layer, distance fog, ACES
tone mapping, MSAA / SMAA, ambient occlusion (N8AO), bloom, vignette and a
speed-dependent radial blur.

**Audio** (`src/game/audio/AudioEngine.ts`) — fully synthesised: engine
harmonics tied to RPM and throttle, shift cut and overrun pops, tyre scrub,
brake hiss, kerb rumble, grass/gravel noise, wind and impacts.

**Performance** — Low / Medium / High / Ultra presets (resolution, shadow map
size, post-processing, anisotropy, scenery density), switchable at any time
from the menu, plus adaptive resolution that scales the render resolution to
hold frame rate. Static geometry is merged and instanced (about 100 draw
calls, 0.7 M triangles), shaders are pre-compiled behind the loading screen,
and HUD telemetry is written straight to the DOM without React re-renders.

## Honest limitations

- **The car is a procedural stand-in**, not a photorealistic production
  model. No legally usable high-detail Formula GLB could be obtained while
  building this. The loader will use `public/models/formula_car.glb` if you
  add one — see [ASSETS.md](./ASSETS.md).
- Scenery and textures are also procedural. The result is a clean,
  consistent, physically lit look, but it is not AAA-level photorealism;
  that would need scanned textures and authored models.
- The circuit has no elevation change.
- The pit lane is scenery only; it cannot be driven into.
- Frame rate on real GPUs was not measured: development and testing ran in a
  headless browser with software rendering, which verifies correctness but
  says nothing about speed. If it is slow on your machine, drop a preset.
- Keyboard and touch only (no gamepad or wheel support).
- Touch support was tested with emulated phone viewports and multi-touch
  events in Chromium. It has not been run on a physical iPhone or Android
  device, and not in Safari's engine.

## Project layout

```
apex-gp-src/
├─ index.html
├─ ASSETS.md                 attribution and licence notes, GLB instructions
├─ public/
│  ├─ hdr/                   HDRI used for lighting (CC0)
│  └─ models/                drop formula_car.glb here
├─ scripts/simTest.ts        headless physics / lap-logic checks
└─ src/
   ├─ main.tsx, App.tsx
   ├─ game/
   │  ├─ game.ts             session loop: sim, timer, input, audio, countdown
   │  ├─ store.ts            UI state and persisted settings
   │  ├─ input.ts            keyboard
   │  ├─ quality.ts          graphics presets
   │  ├─ Scene.tsx           canvas, asset loading, lighting, sky
   │  ├─ track/              trackData.ts (layout, surfaces), trackScene.ts (visuals)
   │  ├─ vehicle/            vehiclePhysics.ts, proceduralCar.ts, carLoader.ts, autopilot.ts
   │  ├─ timing/lapTimer.ts
   │  ├─ camera/CameraRig.tsx
   │  ├─ audio/AudioEngine.ts
   │  └─ gfx/                textures.ts, environment.ts, Effects.tsx, SpeedBlurEffect.ts
   └─ ui/                    HUD, touch controls, menus, loading screen, styles
```
