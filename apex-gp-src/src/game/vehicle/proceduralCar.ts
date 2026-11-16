/**
 * Procedural Formula-style car ("AX-01").
 *
 * IMPORTANT: this is a *procedural stand-in*, not a scanned or artist-made
 * model. It is built from lofted surfaces, aerofoil sections, lathed tyres and
 * tube geometry so it reads as a modern open-wheel car, but it does not have
 * the surface detail of a production GLB asset. Drop a licensed model at
 * public/models/formula_car.glb and CarModel.tsx will use that instead.
 *
 * Car frame: +X forward, +Y up, +Z right. Origin on the ground under the CG.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, CatmullRomCurve3, CircleGeometry, Color, CylinderGeometry,
  DoubleSide, ExtrudeGeometry, Group, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, Object3D, PlaneGeometry, Quaternion, Shape, SphereGeometry, SplineCurve, TorusGeometry,
  TubeGeometry, Vector2, Vector3, type Material,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CAR, type VehicleState } from './vehiclePhysics'
import { makeCarbon, makeDecal, makeLivery, makeTyre } from '../gfx/textures'

export interface CarVisual {
  root: Group
  /** true when this is the built-in procedural stand-in */
  placeholder: boolean
  update(state: VehicleState, dt: number): void
  setCockpitView(on: boolean): void
  dispose(): void
}

export const LIVERY = { primary: '#123c9c', accent: '#ff5a1f', dark: '#0b0c0f' }

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

interface Section { x: number; w: number; bot: number; top: number; e?: number; zc?: number }

const spow = (v: number, p: number) => Math.sign(v) * Math.abs(v) ** p

function cr(a: number, b: number, c: number, d: number, t: number) {
  // uniform Catmull-Rom
  const t2 = t * t, t3 = t2 * t
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
}

/** Smooth lofted body through superellipse cross-sections (nose -> tail). */
function loft(sections: Section[], radial = 28, sub = 6): BufferGeometry {
  const rings: Required<Section>[] = []
  const get = (i: number) => sections[Math.max(0, Math.min(sections.length - 1, i))]
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < sub; k++) {
      const t = k / sub
      const f = (key: keyof Section, def = 0) =>
        cr((get(i - 1)[key] ?? def), (get(i)[key] ?? def), (get(i + 1)[key] ?? def), (get(i + 2)[key] ?? def), t)
      rings.push({ x: f('x'), w: Math.max(0.004, f('w')), bot: f('bot'), top: f('top'), e: f('e', 2.6), zc: f('zc') })
    }
  }
  const last = sections[sections.length - 1]
  rings.push({ x: last.x, w: last.w, bot: last.bot, top: last.top, e: last.e ?? 2.6, zc: last.zc ?? 0 })

  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const n = rings.length
  for (let i = 0; i < n; i++) {
    const r = rings[i]
    const yc = (r.top + r.bot) / 2, hh = Math.max(0.004, (r.top - r.bot) / 2)
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const c = Math.sin(a), s = -Math.cos(a)
      pos.push(r.x, yc + hh * spow(s, 2 / r.e), r.zc + r.w * spow(c, 2 / r.e))
      uv.push(i / (n - 1), j / radial)
    }
  }
  const row = radial + 1
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1
    idx.push(a, b, c, b, d, c)
  }
  // end caps
  for (const end of [0, n - 1]) {
    const r = rings[end]
    const ci = pos.length / 3
    pos.push(r.x, (r.top + r.bot) / 2, r.zc)
    uv.push(end ? 1 : 0, 0.5)
    for (let j = 0; j < radial; j++) {
      const a = end * row + j, b = a + 1
      if (end === 0) idx.push(ci, b, a); else idx.push(ci, a, b)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

interface WingStation { z: number; x: number; y: number; chord: number; pitch: number; thick?: number }

/** Aerofoil swept through spanwise stations (inverted camber = downforce). */
function wing(stations: WingStation[], seg = 14): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  const n = stations.length
  for (let i = 0; i < n; i++) {
    const s = stations[i]
    const th = s.thick ?? 0.016
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2
      const cN = 0.5 - 0.5 * Math.cos(a) // 0 at LE, 1 at TE
      const c = cN * s.chord
      const t = Math.sin(a) * th * (1 - 0.7 * cN) + 0.3 * s.chord * 0.25 * cN * cN
      const cp = Math.cos(s.pitch), sp = Math.sin(s.pitch)
      pos.push(s.x - (c * cp - t * sp), s.y + c * sp + t * cp, s.z)
      uv.push(i / (n - 1), k / seg)
    }
  }
  const row = seg + 1
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
    const a = i * row + k, b = a + 1, c = a + row, d = c + 1
    idx.push(a, b, c, b, d, c)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function span(half: number, n: number, f: (z: number, t: number) => Omit<WingStation, 'z'>): WingStation[] {
  const out: WingStation[] = []
  for (let i = 0; i <= n; i++) {
    const z = -half + (2 * half * i) / n
    out.push({ z, ...f(z, Math.abs(z) / half) })
  }
  return out
}

/** Flat plate from an (x, y) outline, extruded across z and centred on `z`. */
function plate(points: [number, number][], thickness: number, z: number): BufferGeometry {
  const sh = new Shape(points.map(([x, y]) => new Vector2(x, y)))
  const g = new ExtrudeGeometry(sh, { depth: thickness, bevelEnabled: false, curveSegments: 4 })
  g.translate(0, 0, z - thickness / 2)
  return g
}

/** Thin blade-section rod between two points (suspension members). */
function rod(a: Vector3, b: Vector3, width = 0.045, thick = 0.014): BufferGeometry {
  const dir = b.clone().sub(a)
  const len = dir.length()
  const g = new CylinderGeometry(0.5, 0.5, len, 8, 1)
  g.rotateZ(Math.PI / 2) // along X
  g.scale(1, thick, width)
  const q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), dir.normalize())
  g.applyMatrix4(new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(1, 1, 1)))
  return g
}

function tube(points: [number, number, number][], radius: number, seg = 40): BufferGeometry {
  const curve = new CatmullRomCurve3(points.map(p => new Vector3(...p)), false, 'catmullrom', 0.5)
  return new TubeGeometry(curve, seg, radius, 10, false)
}

function at(g: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): BufferGeometry {
  if (rx) g.rotateX(rx)
  if (ry) g.rotateY(ry)
  if (rz) g.rotateZ(rz)
  g.translate(x, y, z)
  return g
}

function mirrorZ(g: BufferGeometry): BufferGeometry {
  const m = g.clone()
  m.scale(1, 1, -1)
  // flip winding so normals stay outward
  const idx = m.getIndex()
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array
    for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t }
  } else {
    for (const name of Object.keys(m.attributes)) {
      const at2 = m.attributes[name] as BufferAttribute
      const n = at2.itemSize
      const arr = at2.array as Float32Array
      for (let i = 0; i < arr.length; i += 3 * n) for (let k = 0; k < n; k++) {
        const t = arr[i + k]; arr[i + k] = arr[i + n + k]; arr[i + n + k] = t
      }
    }
  }
  m.computeVertexNormals()
  return m
}

class Parts {
  private map = new Map<string, BufferGeometry[]>()
  add(key: string, ...gs: BufferGeometry[]) {
    const list = this.map.get(key) ?? []
    for (const g of gs) {
      const ng = g.index ? g.toNonIndexed() : g
      if (!ng.attributes.normal) ng.computeVertexNormals()
      // keep only the attributes every part shares
      for (const name of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(name)) ng.deleteAttribute(name)
      list.push(ng)
    }
    this.map.set(key, list)
  }
  both(key: string, g: BufferGeometry) { this.add(key, g, mirrorZ(g)) }
  build(materials: Record<string, Material>, parent: Object3D) {
    for (const [key, list] of this.map) {
      const merged = mergeGeometries(list, false)
      if (!merged) continue
      const mesh = new Mesh(merged, materials[key])
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = key
      parent.add(mesh)
    }
  }
}

// ---------------------------------------------------------------------------
// the car
// ---------------------------------------------------------------------------

const FRONT_X = CAR.cgToFront
const REAR_X = -CAR.cgToRear
const R = CAR.wheelRadius

function buildWheel(width: number, mats: Record<string, Material>) {
  // tyre: lathed profile, outer face towards +Z
  const hw = width / 2, rim = 0.232
  const prof = new SplineCurve([
    new Vector2(rim, -hw + 0.03), new Vector2(rim + 0.03, -hw + 0.004), new Vector2(R - 0.06, -hw - 0.014),
    new Vector2(R - 0.014, -hw + 0.022), new Vector2(R, -hw + 0.07), new Vector2(R, 0), new Vector2(R, hw - 0.07),
    new Vector2(R - 0.014, hw - 0.022), new Vector2(R - 0.06, hw + 0.014), new Vector2(rim + 0.03, hw - 0.004),
    new Vector2(rim, hw - 0.03),
  ]).getPoints(44)
  const tyre = new LatheGeometry(prof, 56)
  tyre.rotateX(Math.PI / 2)
  const tyreMesh = new Mesh(tyre, mats.tyre)

  const parts = new Parts()
  // wheel cover (outer) and barrel
  const cover = new LatheGeometry([
    new Vector2(0.001, hw - 0.052), new Vector2(0.05, hw - 0.052), new Vector2(0.075, hw - 0.036),
    new Vector2(0.19, hw - 0.022), new Vector2(rim - 0.012, hw - 0.03), new Vector2(rim + 0.004, hw - 0.022),
    new Vector2(rim + 0.004, hw - 0.07),
  ], 48)
  cover.rotateX(Math.PI / 2)
  parts.add('rim', cover)
  const barrel = new CylinderGeometry(rim + 0.002, rim + 0.002, width - 0.06, 40, 1, true)
  barrel.rotateX(Math.PI / 2)
  parts.add('rimDark', barrel)
  // inner brake drum / duct
  const drum = new CylinderGeometry(rim - 0.03, rim - 0.03, width * 0.7, 32, 1, false)
  drum.rotateX(Math.PI / 2)
  drum.translate(0, 0, -hw * 0.28)
  parts.add('carbon', drum)
  // spokes + nut make the rotation readable
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const sp = new BoxGeometry(0.13, 0.016, 0.006)
    sp.translate(0.135, 0, hw - 0.023)
    sp.rotateZ(a)
    parts.add('rimBright', sp)
  }
  const nut = new CylinderGeometry(0.03, 0.036, 0.03, 6)
  nut.rotateX(Math.PI / 2); nut.translate(0, 0, hw - 0.04)
  parts.add('accent', nut)
  const lip = new TorusGeometry(rim + 0.002, 0.007, 8, 48)
  lip.translate(0, 0, hw - 0.024)
  parts.add('rimBright', lip)

  const spin = new Group()
  tyreMesh.castShadow = true
  tyreMesh.receiveShadow = true
  spin.add(tyreMesh)
  parts.build(mats, spin)
  return spin
}

export function buildProceduralCar(): CarVisual {
  const carbonTex = makeCarbon()
  carbonTex.map.repeat.set(10, 10); carbonTex.normalMap.repeat.set(10, 10); carbonTex.roughnessMap.repeat.set(10, 10)
  const livery = makeLivery(LIVERY.primary, LIVERY.accent, LIVERY.dark)
  const tyreTex = makeTyre()
  const textures = [carbonTex.map, carbonTex.normalMap, carbonTex.roughnessMap, livery, tyreTex]

  const paintBase = { metalness: 0.55, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.15 }
  const brake = new MeshStandardMaterial({ color: '#2a0303', emissive: new Color('#ff1a12'), emissiveIntensity: 0.6, roughness: 0.4 })
  const mats: Record<string, Material> = {
    livery: new MeshPhysicalMaterial({ ...paintBase, map: livery }),
    paint: new MeshPhysicalMaterial({ ...paintBase, color: LIVERY.primary }),
    accent: new MeshPhysicalMaterial({ ...paintBase, color: LIVERY.accent }),
    white: new MeshPhysicalMaterial({ ...paintBase, color: '#f1f1ee', metalness: 0.1 }),
    carbon: new MeshPhysicalMaterial({
      color: '#ffffff', map: carbonTex.map, normalMap: carbonTex.normalMap, roughnessMap: carbonTex.roughnessMap,
      normalScale: new Vector2(0.3, 0.3), metalness: 0, roughness: 1, clearcoat: 0.12, clearcoatRoughness: 0.4,
      side: DoubleSide, envMapIntensity: 0.5,
    }),
    matte: new MeshStandardMaterial({ color: '#08080a', roughness: 0.85, metalness: 0.1 }),
    tyre: new MeshStandardMaterial({ map: tyreTex, roughness: 0.88, metalness: 0 }),
    rim: new MeshStandardMaterial({ color: '#17181b', metalness: 0.9, roughness: 0.38 }),
    rimDark: new MeshStandardMaterial({ color: '#0c0c0e', metalness: 0.8, roughness: 0.5, side: DoubleSide }),
    rimBright: new MeshStandardMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.25 }),
    metal: new MeshStandardMaterial({ color: '#8d9197', metalness: 1, roughness: 0.3 }),
    visor: new MeshPhysicalMaterial({ color: '#0a0a12', metalness: 0.9, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.6 }),
    brake,
  }

  const root = new Group()
  root.name = 'ProceduralFormulaCar'
  const body = new Group()
  root.add(body)
  const P = new Parts()
  const V = (x: number, y: number, z: number) => new Vector3(x, y, z)

  // --- monocoque, nose and gearbox ----------------------------------------
  const mainBody = loft([
    { x: 2.80, w: 0.05, bot: 0.14, top: 0.19, e: 2.2 },
    { x: 2.62, w: 0.10, bot: 0.145, top: 0.25, e: 2.3 },
    { x: 2.25, w: 0.145, bot: 0.17, top: 0.37, e: 2.5 },
    { x: 1.80, w: 0.19, bot: 0.19, top: 0.47, e: 2.8 },
    { x: 1.30, w: 0.245, bot: 0.15, top: 0.545, e: 3 },
    { x: 0.80, w: 0.30, bot: 0.09, top: 0.59, e: 3.2 },
    { x: 0.35, w: 0.345, bot: 0.07, top: 0.60, e: 3.4 },
    { x: -0.10, w: 0.36, bot: 0.07, top: 0.60, e: 3.4 },
    { x: -0.55, w: 0.345, bot: 0.07, top: 0.66, e: 3 },
    { x: -1.05, w: 0.29, bot: 0.075, top: 0.60, e: 2.8 },
    { x: -1.55, w: 0.21, bot: 0.08, top: 0.49, e: 2.6 },
    { x: -2.05, w: 0.13, bot: 0.11, top: 0.39, e: 2.4 },
    { x: -2.45, w: 0.085, bot: 0.17, top: 0.34, e: 2.2 },
    { x: -2.66, w: 0.06, bot: 0.21, top: 0.33, e: 2.2 },
  ], 32, 6)
  const liveryMesh = new Mesh(mainBody, mats.livery)
  liveryMesh.castShadow = liveryMesh.receiveShadow = true
  body.add(liveryMesh)

  // --- airbox and engine cover --------------------------------------------
  P.add('paint', loft([
    { x: -0.28, w: 0.115, bot: 0.66, top: 0.965, e: 2.4 },
    { x: -0.50, w: 0.15, bot: 0.56, top: 0.985, e: 2.4 },
    { x: -0.90, w: 0.16, bot: 0.50, top: 0.93, e: 2.3 },
    { x: -1.40, w: 0.12, bot: 0.44, top: 0.77, e: 2.2 },
    { x: -1.90, w: 0.07, bot: 0.36, top: 0.58, e: 2.1 },
    { x: -2.35, w: 0.03, bot: 0.30, top: 0.42, e: 2 },
  ], 24, 6))
  P.add('matte', at(new CircleGeometry(1, 24).scale(0.095, 0.125, 1), -0.272, 0.825, 0, 0, Math.PI / 2))
  // shark fin
  P.add('carbon', plate([[-0.8, 0.975], [-1.55, 0.94], [-2.22, 0.66], [-2.26, 0.42], [-1.6, 0.6], [-0.8, 0.9]], 0.012, 0))
  // T-camera
  P.add('carbon', at(new BoxGeometry(0.16, 0.035, 0.05), -0.52, 1.0, 0))
  P.add('carbon', at(new BoxGeometry(0.05, 0.03, 0.2), -0.52, 1.005, 0))

  // --- sidepods -------------------------------------------------------------
  const pod = loft([
    { x: 0.66, w: 0.20, bot: 0.30, top: 0.535, zc: 0.60, e: 3.2 },
    { x: 0.40, w: 0.255, bot: 0.14, top: 0.575, zc: 0.60, e: 3.4 },
    { x: -0.10, w: 0.275, bot: 0.085, top: 0.57, zc: 0.60, e: 3.2 },
    { x: -0.70, w: 0.26, bot: 0.08, top: 0.50, zc: 0.57, e: 2.8 },
    { x: -1.30, w: 0.19, bot: 0.08, top: 0.37, zc: 0.46, e: 2.5 },
    { x: -1.85, w: 0.10, bot: 0.08, top: 0.24, zc: 0.30, e: 2.3 },
    { x: -2.15, w: 0.04, bot: 0.085, top: 0.16, zc: 0.20, e: 2.2 },
  ], 26, 6)
  P.both('paint', pod)
  P.both('matte', at(new CircleGeometry(1, 24).scale(0.175, 0.095, 1), 0.664, 0.42, 0.60, 0, Math.PI / 2))
  // undercut inlet lip
  P.both('carbon', at(new BoxGeometry(0.05, 0.012, 0.44), 0.69, 0.30, 0.60))

  // --- floor, fences, diffuser ---------------------------------------------
  {
    const half: [number, number][] = [[1.12, 0.26], [0.9, 0.42], [0.55, 0.8], [0.2, 0.84], [-1.25, 0.84], [-1.5, 0.74], [-1.62, 0.55], [-2.15, 0.52]]
    const outline = [...half, ...half.slice().reverse().map(([x, z]) => [x, -z] as [number, number])]
    const sh = new Shape(outline.map(([x, z]) => new Vector2(x, z)))
    const floor = new ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: false })
    floor.rotateX(Math.PI / 2)
    floor.translate(0, 0.075, 0)
    P.add('carbon', floor)
    // raised floor edge
    P.both('carbon', at(new BoxGeometry(1.4, 0.035, 0.012), -0.52, 0.09, 0.835))
    for (let i = 0; i < 3; i++) {
      P.both('carbon', at(new BoxGeometry(0.42, 0.13 - i * 0.02, 0.008), 0.86 - i * 0.03, 0.14, 0.34 + i * 0.1, 0, -0.32 - i * 0.12))
    }
    // diffuser ramp + strakes
    P.add('carbon', at(new BoxGeometry(0.62, 0.012, 1.0), -2.36, 0.165, 0, 0, 0, -0.33))
    for (const z of [-0.48, -0.24, 0, 0.24, 0.48]) {
      P.add('carbon', plate([[-2.08, 0.06], [-2.66, 0.06], [-2.66, 0.27], [-2.4, 0.18]], 0.008, z))
    }
  }

  // --- front wing -----------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const g = wing(span(0.955, 18, (z, t) => ({
      x: 2.93 - i * 0.135 - 0.2 * t * t - (i > 0 ? 0.02 : 0),
      y: 0.078 + i * 0.047 + (i > 0 ? 0.03 * Math.max(0, 1 - t * 3.2) : 0) - 0.012 * t,
      chord: i === 0 ? 0.25 : 0.165 * (1 - 0.25 * Math.max(0, 1 - t * 4) * (i > 1 ? 1 : 0)),
      pitch: 0.06 + i * 0.15 + 0.1 * t * (i > 0 ? 1 : 0),
      thick: i === 0 ? 0.017 : 0.012,
    })))
    P.add(i === 3 ? 'accent' : 'carbon', g)
  }
  P.both('carbon', plate([[2.9, 0.045], [2.2, 0.045], [2.14, 0.3], [2.4, 0.31], [2.78, 0.2], [2.93, 0.1]], 0.012, 0.962))
  P.both('carbon', at(new BoxGeometry(0.5, 0.012, 0.09), 2.42, 0.052, 0.92)) // footplate
  // nose camera pods
  P.both('carbon', at(new BoxGeometry(0.11, 0.035, 0.07), 1.95, 0.4, 0.2))

  // --- rear wing ------------------------------------------------------------
  P.add('carbon', wing(span(0.5, 12, (z, t) => ({
    x: -2.26, y: 0.845 - 0.04 * (1 - t * t), chord: 0.33, pitch: 0.2 + 0.06 * (1 - t), thick: 0.02,
  }))))
  const flap = wing(span(0.5, 12, () => ({ x: -2.56, y: 0.925, chord: 0.2, pitch: 0.72, thick: 0.012 })))
  P.add('accent', flap)
  P.add('carbon', wing(span(0.46, 8, () => ({ x: -2.38, y: 0.44, chord: 0.2, pitch: 0.3, thick: 0.012 }))))
  P.add('carbon', wing(span(0.46, 8, () => ({ x: -2.5, y: 0.52, chord: 0.14, pitch: 0.5, thick: 0.01 }))))
  P.both('carbon', plate([[-2.2, 0.36], [-2.78, 0.4], [-2.84, 0.72], [-2.8, 1.06], [-2.3, 1.06], [-2.18, 0.7]], 0.014, 0.508))
  // swan-neck pylon + DRS actuator
  P.add('carbon', plate([[-2.12, 0.4], [-2.3, 0.38], [-2.42, 0.9], [-2.3, 0.94], [-2.25, 0.86]], 0.022, 0))
  P.add('carbon', at(new BoxGeometry(0.2, 0.035, 0.045), -2.5, 1.0, 0))
  // rain / brake lights
  P.add('brake', at(new BoxGeometry(0.03, 0.1, 0.055), -2.672, 0.275, 0))
  P.both('brake', at(new BoxGeometry(0.012, 0.16, 0.018), -2.82, 0.62, 0.508))
  // exhaust
  const exh = new CylinderGeometry(0.05, 0.055, 0.22, 16, 1, true)
  P.add('metal', at(exh, -2.45, 0.42, 0, 0, 0, Math.PI / 2))
  P.add('matte', at(new CircleGeometry(0.048, 16), -2.555, 0.42, 0, 0, -Math.PI / 2))

  // --- cockpit, halo, driver ------------------------------------------------
  P.add('matte', at(new SphereGeometry(1, 24, 12).scale(0.42, 0.06, 0.225), 0.0, 0.585, 0))
  P.add('paint', tube([
    [0.48, 0.60, 0.2], [0.2, 0.635, 0.265], [-0.2, 0.67, 0.275], [-0.42, 0.72, 0.2], [-0.5, 0.74, 0],
    [-0.42, 0.72, -0.2], [-0.2, 0.67, -0.275], [0.2, 0.635, -0.265], [0.48, 0.60, -0.2],
  ], 0.048, 48))
  // halo: centre pillar + hoop
  P.add('carbon', tube([[0.8, 0.585, 0], [0.7, 0.76, 0], [0.54, 0.925, 0]], 0.03, 12))
  P.add('carbon', tube([
    [-0.52, 0.75, 0.3], [-0.2, 0.9, 0.315], [0.22, 0.94, 0.26], [0.47, 0.935, 0.12], [0.54, 0.93, 0],
    [0.47, 0.935, -0.12], [0.22, 0.94, -0.26], [-0.2, 0.9, -0.315], [-0.52, 0.75, -0.3],
  ], 0.03, 56))
  // mirrors
  P.both('paint', at(new SphereGeometry(1, 14, 10).scale(0.055, 0.032, 0.075), 0.7, 0.69, 0.6))
  P.both('carbon', rod(V(0.66, 0.59, 0.3), V(0.7, 0.675, 0.56), 0.04, 0.01))
  // pitot + antenna
  P.add('metal', at(new CylinderGeometry(0.004, 0.004, 0.14, 6), 1.5, 0.58, 0))
  P.add('metal', at(new CylinderGeometry(0.004, 0.004, 0.2, 6), 1.1, 0.64, 0.05))

  const driver = new Group()
  const helmet = new Mesh(new SphereGeometry(0.135, 28, 20).scale(1.1, 1, 0.94), mats.white)
  helmet.position.set(-0.06, 0.795, 0)
  const visor = new Mesh(new SphereGeometry(0.139, 24, 10, Math.PI - 1.0, 2.0, 1.12, 0.5).scale(1.1, 1, 0.94), mats.visor)
  visor.position.copy(helmet.position)
  const stripe = new Mesh(new SphereGeometry(0.137, 24, 6, 0, Math.PI * 2, 0.0, 0.5).scale(1.1, 1, 0.94), mats.accent)
  stripe.position.copy(helmet.position)
  const torso = new Mesh(new SphereGeometry(1, 16, 10).scale(0.2, 0.12, 0.2), mats.matte)
  torso.position.set(-0.08, 0.62, 0)
  driver.add(helmet, visor, stripe, torso)
  for (const m of [helmet, visor, stripe]) m.castShadow = true
  body.add(driver)

  // steering wheel
  const steering = new Group()
  steering.position.set(0.36, 0.615, 0)
  steering.rotation.z = -0.25
  const swMesh = new Mesh(mergeGeometries([
    new BoxGeometry(0.03, 0.12, 0.27).toNonIndexed(),
    at(new BoxGeometry(0.035, 0.16, 0.05), 0, -0.01, 0.125).toNonIndexed(),
    at(new BoxGeometry(0.035, 0.16, 0.05), 0, -0.01, -0.125).toNonIndexed(),
  ])!, mats.matte)
  const swScreen = new Mesh(new PlaneGeometry(0.1, 0.06), new MeshBasicMaterial({ color: '#1ad6ff' }))
  swScreen.rotation.y = -Math.PI / 2
  swScreen.position.set(-0.016, 0.01, 0)
  const swSpin = new Group()
  swSpin.add(swMesh, swScreen)
  steering.add(swSpin)
  body.add(steering)

  // --- suspension -----------------------------------------------------------
  const fz = CAR.trackWidth / 2 - 0.18
  P.both('carbon', rod(V(FRONT_X, 0.5, fz), V(FRONT_X + 0.28, 0.46, 0.17)))
  P.both('carbon', rod(V(FRONT_X, 0.5, fz), V(FRONT_X - 0.42, 0.5, 0.22)))
  P.both('carbon', rod(V(FRONT_X, 0.21, fz), V(FRONT_X + 0.3, 0.23, 0.15)))
  P.both('carbon', rod(V(FRONT_X, 0.21, fz), V(FRONT_X - 0.46, 0.19, 0.23)))
  P.both('carbon', rod(V(FRONT_X - 0.02, 0.24, fz - 0.02), V(FRONT_X - 0.12, 0.5, 0.2), 0.03, 0.014)) // pushrod
  P.both('carbon', rod(V(FRONT_X - 0.13, 0.36, fz), V(FRONT_X - 0.2, 0.38, 0.2), 0.028, 0.012)) // track rod
  const rz = CAR.trackWidth / 2 - 0.2
  P.both('carbon', rod(V(REAR_X, 0.5, rz), V(REAR_X + 0.5, 0.43, 0.2)))
  P.both('carbon', rod(V(REAR_X, 0.5, rz), V(REAR_X - 0.3, 0.37, 0.09)))
  P.both('carbon', rod(V(REAR_X, 0.2, rz), V(REAR_X + 0.52, 0.16, 0.2)))
  P.both('carbon', rod(V(REAR_X, 0.2, rz), V(REAR_X - 0.32, 0.2, 0.09)))
  P.both('carbon', rod(V(REAR_X + 0.04, 0.48, rz), V(REAR_X + 0.3, 0.2, 0.16), 0.03, 0.014)) // pullrod
  P.both('metal', at(new CylinderGeometry(0.02, 0.02, 0.5, 8), REAR_X, 0.35, 0.36, Math.PI / 2)) // driveshaft
  // uprights / brake ducts
  P.both('carbon', at(new BoxGeometry(0.2, 0.34, 0.06), FRONT_X, 0.36, fz + 0.03))
  P.both('carbon', at(new BoxGeometry(0.22, 0.34, 0.06), REAR_X, 0.36, rz + 0.03))

  P.build(mats, body)

  // --- decals ---------------------------------------------------------------
  const decalTextures = [
    makeDecal('7', '#ffffff', { w: 256, h: 256 }),
    makeDecal('APEX', '#ffffff'),
    makeDecal('NORDWIND', '#ffffff', { w: 1024, h: 128 }),
    makeDecal('VELOX', LIVERY.accent),
  ]
  textures.push(...decalTextures)
  const decal = (tex: (typeof decalTextures)[number], w: number, h: number, x: number, y: number, z: number, ry: number, rx = 0) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
    }))
    m.rotation.set(rx, ry, 0, 'YXZ')
    m.position.set(x, y, z)
    body.add(m)
  }
  for (const s of [1, -1]) {
    const ry = s > 0 ? 0 : Math.PI
    decal(decalTextures[0], 0.26, 0.26, -1.45, 0.78, s * 0.008, ry) // number on the fin
    decal(decalTextures[1], 0.44, 0.11, -2.52, 0.86, s * 0.517, ry) // rear wing end plates
    decal(decalTextures[3], 0.36, 0.09, 2.5, 0.2, s * 0.97, ry) // front wing end plates
  }
  decal(decalTextures[2], 0.86, 0.108, -2.725, 1.005, 0, -Math.PI / 2, -0.6) // rear wing flap, faces the chase cam
  decal(decalTextures[0], 0.2, 0.2, 2.02, 0.428, 0, -Math.PI / 2, -Math.PI / 2 + 0.2) // nose top

  // --- wheels ---------------------------------------------------------------
  const wheelDefs = [
    { x: FRONT_X, z: -0.8, w: 0.31, front: true },
    { x: FRONT_X, z: 0.8, w: 0.31, front: true },
    { x: REAR_X, z: -0.775, w: 0.4, front: false },
    { x: REAR_X, z: 0.775, w: 0.4, front: false },
  ]
  const wheels = wheelDefs.map(d => {
    const pivot = new Group()
    pivot.position.set(d.x, R, d.z)
    const side = new Group()
    if (d.z < 0) side.rotation.y = Math.PI // outer face outwards
    const spin = buildWheel(d.w, mats)
    side.add(spin)
    pivot.add(side)
    root.add(pivot)
    return { pivot, spin, front: d.front, sign: d.z < 0 ? 1 : -1 }
  })

  let brakeGlow = 0.6
  let blink = 0
  return {
    root,
    placeholder: true,
    update(s, dt) {
      for (const w of wheels) {
        w.spin.rotation.z = w.sign * s.wheelRot
        if (w.front) w.pivot.rotation.y = -s.steerAngle
      }
      swSpin.rotation.x = s.steerInput * 1.6
      // tiny chassis attitude changes: stiff, but alive
      const k = Math.min(1, dt * 10)
      body.rotation.z += (s.gLong * 0.0045 - body.rotation.z) * k
      body.rotation.x += (-s.gLat * 0.0055 - body.rotation.x) * k
      body.position.y += (-Math.min(0.018, s.speed * s.speed * 2.4e-6) - body.position.y) * k
      // rain light: steady glow, bright under braking, flashes while harvesting off-throttle
      blink += dt
      const target = s.brake > 0.05 ? 7 : s.throttle < 0.05 && s.speed > 20 ? (Math.sin(blink * 22) > 0 ? 4 : 0.3) : 0.6
      brakeGlow += (target - brakeGlow) * Math.min(1, dt * 30)
      brake.emissiveIntensity = brakeGlow
    },
    setCockpitView(on) {
      driver.visible = !on
    },
    dispose() {
      root.traverse(o => { if ((o as Mesh).isMesh) (o as Mesh).geometry.dispose() })
      for (const m of Object.values(mats)) m.dispose()
      for (const t of textures) t.dispose()
    },
  }
}
