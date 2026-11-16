# Assets, attribution and licences

APEX GP ships with almost no third-party assets. Everything except the HDRI is
generated in code at load time.

| Asset | Source | Licence |
| --- | --- | --- |
| `public/hdr/rooitou_park_1k.hdr` (image-based lighting and reflections) | "Rooitou Park" by Greg Zaal, Poly Haven, obtained via the `pmndrs/drei-assets` mirror | CC0 1.0 (public domain) |
| Car model "AX-01" | Procedural, `src/game/vehicle/proceduralCar.ts` | Part of this project |
| Circuit, kerbs, barriers, grandstands, pit complex, trees, terrain | Procedural, `src/game/track/trackScene.ts` | Part of this project |
| All textures (asphalt, grass, gravel, concrete, carbon fibre, tyres, kerbs, crowd, fences, sponsor boards, livery, clouds) | Procedural canvas textures, `src/game/gfx/textures.ts` | Part of this project |
| All audio (engine, shifts, tyres, brakes, wind, kerbs, impacts, start beeps) | Procedural Web Audio synthesis, `src/game/audio/AudioEngine.ts` | Part of this project |

The circuit ("Circuito Costa Verde"), the car, the team livery and every
sponsor name on the boards (VELOX, NORDWIND, Kairos Energy, HELIX, ORBITAL,
MERIDIAN, APEX GP) are fictional. No real team, series, circuit or brand is
depicted.

Runtime libraries (all MIT or Apache-2.0): React, Three.js, React Three Fiber,
Drei, @react-three/postprocessing, postprocessing, Rapier
(`@dimforge/rapier3d-compat`), Zustand, Vite.

## About the car model

The car is a **procedural stand-in**, not an artist-made or scanned model. No
legally usable high-detail Formula car GLB was available when this was built
(the asset hosts that carry them were not reachable from the build
environment), so the car is generated from lofted body sections, aerofoil
wing elements, lathed tyres and tube geometry with PBR paint, carbon and
rubber materials. It has the right silhouette and parts (multi-element front
and rear wings, halo, sidepods, floor and diffuser, wishbones and push/pull
rods, steering wheel, rain light) but not the surface detail of a production
game asset.

### Using a real GLB

1. Put the file at `public/models/formula_car.glb`. It is picked up
   automatically; nothing else needs to change.
2. Conventions the loader (`src/game/vehicle/carLoader.ts`) understands:
   - The car should face +X or +Z; it is rescaled to 5.6 m long and dropped
     onto the ground automatically.
   - Wheel nodes named `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR` (case
     insensitive; `-`, `.` or no separator also work) spin, and the front
     pair steers. Their local Z axis should be the axle.
   - An optional `steering_wheel` node turns with the input.
   - Nodes with `helmet` or `driver` in the name are hidden in cockpit view.
3. Add the model's author, source URL and licence to the table above.
