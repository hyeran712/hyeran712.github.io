/**
 * Builds all static circuit visuals as a single THREE.Group.
 * Geometry is generated from the same samples the physics uses (trackData.ts),
 * so what you see is exactly what you collide with.
 */
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  Quaternion, Vector3, type Material, type Texture,
} from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  CURB_WIDTH, GRAVEL_END_MARGIN, GRAVEL_START, PIT, TRACK_HALF_WIDTH, track, type TrackSample,
} from './trackData'
import {
  makeAdStrip, makeAsphalt, makeBillboard, makeChequer, makeConcrete, makeCrowd, makeCurb, makeDecal, makeFence,
  makeGarage, makeGrass, makeGravel, makeTyreWall, mulberry32,
} from '../gfx/textures'

const { samples, count, length: LAP } = track
const HALF = TRACK_HALF_WIDTH

export interface TrackSceneOptions {
  anisotropy: number
  /** 0..1 density multiplier for trees and props */
  detail: number
}

export interface TrackScene {
  group: Group
  /** number of red start lights lit (0-5) */
  setStartLights(n: number): void
  /** apply texture filtering / scenery density without rebuilding */
  applyQuality(anisotropy: number, detail: number): void
  dispose(): void
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type SampleFn = (c: TrackSample, i: number) => number
type Mask = (c: TrackSample, i: number) => boolean

function sRel(c: TrackSample) { return c.s > LAP / 2 ? c.s - LAP : c.s }

/** Horizontal strip following the track between two lateral offsets (d0 < d1). */
function ribbon(o: {
  d0: SampleFn; d1: SampleFn; y0?: number; y1?: number; cols?: number
  uScale?: number; vScale?: number; mask?: Mask
  color?: (c: TrackSample, i: number, d: number) => number
}): BufferGeometry {
  const cols = o.cols ?? 1
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = []
  const row = cols + 1
  for (let i = 0; i <= count; i++) {
    const c = samples[i % count]
    const s = i === count ? LAP : c.s
    const a = o.d0(c, i % count), b = o.d1(c, i % count)
    for (let k = 0; k <= cols; k++) {
      const t = k / cols
      const d = a + (b - a) * t
      pos.push(c.x - c.tz * d, (o.y0 ?? 0) + ((o.y1 ?? o.y0 ?? 0) - (o.y0 ?? 0)) * t, c.z + c.tx * d)
      uv.push(d * (o.uScale ?? 1), s * (o.vScale ?? 1))
      if (o.color) { const v = o.color(c, i % count, d); col.push(v, v, v) }
    }
  }
  for (let i = 0; i < count; i++) {
    if (o.mask && !(o.mask(samples[i], i) && o.mask(samples[(i + 1) % count], (i + 1) % count))) continue
    for (let k = 0; k < cols; k++) {
      const a = i * row + k, b = a + 1, c = a + row, d = c + 1
      idx.push(a, b, c, b, d, c)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  if (o.color) g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Vertical strip (wall / fence / banner) at a lateral offset. */
function wallStrip(o: {
  d: SampleFn; y0: number; y1: number; uScale: number; vScale?: number; mask?: Mask; side: number
}): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = []
  for (let i = 0; i <= count; i++) {
    const c = samples[i % count]
    const s = i === count ? LAP : c.s
    const d = o.d(c, i % count)
    const x = c.x - c.tz * d, z = c.z + c.tx * d
    pos.push(x, o.y0, z, x, o.y1, z)
    uv.push(s * o.uScale, 0, s * o.uScale, (o.y1 - o.y0) * (o.vScale ?? 1 / (o.y1 - o.y0)))
    // face the circuit
    nor.push(c.tz * o.side, 0, -c.tx * o.side, c.tz * o.side, 0, -c.tx * o.side)
  }
  for (let i = 0; i < count; i++) {
    if (o.mask && !(o.mask(samples[i], i) && o.mask(samples[(i + 1) % count], (i + 1) % count))) continue
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3
    idx.push(a, c, b, b, c, d)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
  g.setIndex(idx)
  return g
}

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const tx = x - xi, ty = y - yi
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
function fbm2(x: number, y: number) {
  return noise2(x, y) * 0.5 + noise2(x * 2.1, y * 2.1) * 0.3 + noise2(x * 4.3, y * 4.3) * 0.2
}

// Distance field around the circuit, used for terrain height and tree placement.
const FIELD = (() => {
  const minX = -1900, maxX = 1900, minZ = -1500, maxZ = 1900, cell = 12
  const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1
  const dist = new Float32Array(nx * nz)
  const inside = new Uint8Array(nx * nz)
  const poly: TrackSample[] = []
  for (let i = 0; i < count; i += 6) poly.push(samples[i])
  for (let iz = 0; iz < nz; iz++) {
    const z = minZ + iz * cell
    for (let ix = 0; ix < nx; ix++) {
      const x = minX + ix * cell
      let best = Infinity
      for (let k = 0; k < poly.length; k++) {
        const dx = poly[k].x - x, dz = poly[k].z - z
        const d = dx * dx + dz * dz
        if (d < best) best = d
      }
      dist[iz * nx + ix] = Math.sqrt(best)
      let inp = false
      for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
        const a = poly[k], b = poly[j]
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inp = !inp
      }
      inside[iz * nx + ix] = inp ? 1 : 0
    }
  }
  const sample = (x: number, z: number) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - minX) / cell))
    const fz = Math.max(0, Math.min(nz - 1.001, (z - minZ) / cell))
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz
    const i = iz * nx + ix
    const d = dist[i] * (1 - tx) * (1 - tz) + dist[i + 1] * tx * (1 - tz) + dist[i + nx] * (1 - tx) * tz + dist[i + nx + 1] * tx * tz
    return { d, inside: inside[i] === 1 }
  }
  return { sample }
})()

/** Gentle hills that rise away from the circuit; the infield stays flat. */
export function terrainHeight(x: number, z: number): number {
  const f = FIELD.sample(x, z)
  if (f.inside) return 0
  const t = Math.max(0, Math.min(1, (f.d - 70) / 520))
  const rise = t * t * (3 - 2 * t)
  // small undulations only start well behind the barriers, so runoff areas stay flat
  const u = Math.max(0, Math.min(1, (f.d - 58) / 160))
  return rise * (10 + 95 * fbm2(x * 0.0016 + 3.1, z * 0.0016 + 7.7)) + u * u * 2.5 * (noise2(x * 0.012, z * 0.012) - 0.5)
}

function place(g: BufferGeometry, x: number, y: number, z: number, ry = 0): BufferGeometry {
  if (ry) g.rotateY(ry)
  g.translate(x, y, z)
  return g
}

function merged(list: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(list.map(g => {
    const n = g.index ? g.toNonIndexed() : g
    for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name)
    return n
  }), false)!
}

/** Pose for a prop beside the track: local +X along the track, local +Z away from it. */
function sidePose(index: number, side: number, extra: number) {
  const c = samples[((index % count) + count) % count]
  const d = (side < 0 ? c.wallL : c.wallR) + extra
  const x = c.x - c.tz * side * d, z = c.z + c.tx * side * d
  const yaw = Math.atan2(-c.tz, c.tx) + (side < 0 ? Math.PI : 0)
  return { x, z, yaw, y: Math.max(0, terrainHeight(x, z)) }
}

const indexAtS = (s: number) => Math.round((((s % LAP) + LAP) % LAP) / LAP * count) % count

// ---------------------------------------------------------------------------
// scene
// ---------------------------------------------------------------------------

export function buildTrackScene(opts: TrackSceneOptions): TrackScene {
  const group = new Group()
  group.name = 'Circuit'
  const textures: Texture[] = []
  const materials: Material[] = []
  const tex = <T extends Texture>(t: T, rx = 1, ry = 1): T => {
    t.repeat.set(rx, ry); t.anisotropy = opts.anisotropy; textures.push(t); return t
  }
  const mat = <M extends Material>(m: M): M => { materials.push(m); return m }
  const add = (g: BufferGeometry, m: Material, shadow: 'cast' | 'receive' | 'both' | 'none' = 'receive', order = 0) => {
    const mesh = new Mesh(g, m)
    mesh.castShadow = shadow === 'cast' || shadow === 'both'
    mesh.receiveShadow = shadow === 'receive' || shadow === 'both'
    mesh.matrixAutoUpdate = false
    mesh.renderOrder = order
    group.add(mesh)
    return mesh
  }

  // --- materials ------------------------------------------------------------
  const asphaltT = makeAsphalt()
  ;[asphaltT.map, asphaltT.normalMap, asphaltT.roughnessMap].forEach(t => tex(t))
  const asphalt = mat(new MeshStandardMaterial({
    map: asphaltT.map, normalMap: asphaltT.normalMap, roughnessMap: asphaltT.roughnessMap,
    roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: 0.55,
  }))
  asphalt.normalScale.set(0.55, 0.55)
  const asphaltPlain = mat(new MeshStandardMaterial({
    map: asphaltT.map, normalMap: asphaltT.normalMap, roughnessMap: asphaltT.roughnessMap, roughness: 1,
    color: '#b9bcc2', envMapIntensity: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }))
  const grassT = makeGrass()
  ;[grassT.map, grassT.normalMap, grassT.roughnessMap].forEach(t => tex(t, 420, 420))
  const grass = mat(new MeshStandardMaterial({
    map: grassT.map, normalMap: grassT.normalMap, roughness: 0.95, vertexColors: true, envMapIntensity: 0.5,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
  }))
  const gravelT = makeGravel()
  ;[gravelT.map, gravelT.normalMap, gravelT.roughnessMap].forEach(t => tex(t))
  const gravel = mat(new MeshStandardMaterial({
    map: gravelT.map, normalMap: gravelT.normalMap, roughness: 0.97, envMapIntensity: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }))
  const concreteT = makeConcrete()
  ;[concreteT.map, concreteT.normalMap, concreteT.roughnessMap].forEach(t => tex(t))
  const concrete = mat(new MeshStandardMaterial({
    map: concreteT.map, normalMap: concreteT.normalMap, roughnessMap: concreteT.roughnessMap, roughness: 1,
    side: DoubleSide, envMapIntensity: 0.6,
  }))
  const paintWhite = mat(new MeshStandardMaterial({
    color: '#dcdcd6', roughness: 0.62, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }))
  const paintYellow = mat(new MeshStandardMaterial({
    color: '#d9b21c', roughness: 0.62, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }))
  const curbMat = mat(new MeshStandardMaterial({
    map: tex(makeCurb()), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }))
  const fenceMat = mat(new MeshStandardMaterial({
    map: tex(makeFence()), alphaTest: 0.45, side: DoubleSide, metalness: 0.7, roughness: 0.5, color: '#c4c8cf',
  }))
  const steel = mat(new MeshStandardMaterial({ color: '#8f949b', metalness: 0.85, roughness: 0.42 }))
  const darkSteel = mat(new MeshStandardMaterial({ color: '#25272b', metalness: 0.7, roughness: 0.5 }))
  const whitePanel = mat(new MeshStandardMaterial({ color: '#e6e7e9', roughness: 0.55, metalness: 0.05 }))
  const glass = mat(new MeshPhysicalMaterial({ color: '#0d1820', metalness: 0.9, roughness: 0.06, envMapIntensity: 1.8 }))
  const adMat = mat(new MeshStandardMaterial({ map: tex(makeAdStrip()), roughness: 0.55, side: DoubleSide }))
  const tyreWallMat = mat(new MeshStandardMaterial({ map: tex(makeTyreWall()), roughness: 0.85, side: DoubleSide }))

  // --- terrain ----------------------------------------------------------------
  {
    const g = new PlaneGeometry(3800, 3400, 200, 180)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, 200)
    const p = g.attributes.position as BufferAttribute
    const colors = new Float32Array(p.count * 3)
    const uvs = g.attributes.uv as BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i)
      const h = terrainHeight(x, z)
      p.setY(i, h - 0.04)
      const n = fbm2(x * 0.006 + 11, z * 0.006 + 5)
      const dry = fbm2(x * 0.02, z * 0.02)
      const hill = Math.min(1, h / 90)
      // lush near the track, drier and bluer with altitude
      colors[i * 3] = 0.78 + n * 0.5 + dry * 0.16 - hill * 0.1
      colors[i * 3 + 1] = 0.82 + n * 0.36 - hill * 0.12
      colors[i * 3 + 2] = 0.72 + n * 0.3 + hill * 0.1
      uvs.setXY(i, x / 3800, z / 3400)
    }
    g.setAttribute('color', new BufferAttribute(colors, 3))
    g.computeVertexNormals()
    add(g, grass, 'receive')
  }

  // --- racing surface ---------------------------------------------------------
  add(ribbon({
    d0: () => -HALF - 0.35, d1: () => HALF + 0.35, cols: 10, uScale: 1 / 5, vScale: 1 / 5,
    color: (c, i, d) => {
      // rubbered-in racing line that drifts to the inside of each corner
      const line = Math.max(-0.62, Math.min(0.62, c.k * 70)) * HALF
      const groove = Math.exp(-((d - line) ** 2) / 7) * 0.2
      const patch = (noise2(c.s * 0.021, d * 0.12) - 0.5) * 0.16
      const edge = Math.abs(d) > HALF - 1.2 ? 0.06 : 0
      return 0.98 - groove + patch + edge
    },
  }), asphalt)

  // edge lines
  for (const side of [-1, 1]) {
    const a = side * (HALF - 0.42), b = side * (HALF - 0.22)
    add(ribbon({ d0: () => Math.min(a, b), d1: () => Math.max(a, b), y0: 0.004 }), paintWhite)
  }

  // kerbs: sloped, with a raised outer edge
  for (const side of [-1, 1]) {
    add(ribbon({
      d0: () => (side < 0 ? -HALF - CURB_WIDTH : HALF - 0.05),
      d1: () => (side < 0 ? -HALF + 0.05 : HALF + CURB_WIDTH),
      y0: side < 0 ? 0.07 : 0.008, y1: side < 0 ? 0.008 : 0.07,
      uScale: 1 / CURB_WIDTH, vScale: 1 / 4.4,
      mask: c => (side < 0 ? c.curbL : c.curbR),
    }), curbMat)
  }

  // gravel traps
  for (const side of [-1, 1]) {
    const inner = () => GRAVEL_START
    const outer = (c: TrackSample) => (side < 0 ? c.wallL : c.wallR) - GRAVEL_END_MARGIN
    add(ribbon({
      d0: c => (side < 0 ? -outer(c) : inner()), d1: c => (side < 0 ? -inner() : outer(c)),
      y0: 0.006, cols: 3, uScale: 1 / 3.5, vScale: 1 / 3.5,
      mask: c => (side < 0 ? c.gravelL : c.gravelR),
    }), gravel)
  }

  // --- barriers ---------------------------------------------------------------
  const wallD = (side: number) => (c: TrackSample) => side * (side < 0 ? c.wallL : c.wallR)
  const isPit = (c: TrackSample) => { const r = sRel(c); return r > -PIT.before - 20 && r < PIT.after + 20 }
  for (const side of [-1, 1]) {
    const d = wallD(side)
    const hasTyres: Mask = c => (side < 0 ? c.gravelL : c.gravelR)
    add(wallStrip({ d, y0: -0.1, y1: 1.05, uScale: 1 / 3, vScale: 1 / 3, side }), concrete, 'both')
    add(ribbon({
      d0: c => Math.min(d(c), d(c) + side * 0.45), d1: c => Math.max(d(c), d(c) + side * 0.45), y0: 1.05,
      uScale: 1 / 3, vScale: 1 / 3,
    }), concrete)
    // sponsor banners on plain stretches of wall
    add(wallStrip({
      d: c => d(c) - side * 0.025, y0: 0.08, y1: 0.98, uScale: (side < 0 ? 1 : -1) / 64, side,
      mask: (c, i) => !hasTyres(c, i) && Math.floor(c.s / 96) % 3 !== 1,
    }), adMat)
    // tyre barriers where there is a gravel trap
    add(wallStrip({ d: c => d(c) - side * 0.55, y0: 0, y1: 1.0, uScale: 1 / 0.62, side, mask: hasTyres }), tyreWallMat, 'both')
    add(ribbon({
      d0: c => Math.min(d(c), d(c) - side * 0.55), d1: c => Math.max(d(c), d(c) - side * 0.55), y0: 1.0, mask: hasTyres,
    }), darkSteel)
    // debris fence: outside of corners, grandstand straight and pit wall
    const fenced: Mask = (c, i) => hasTyres(c, i) || isPit(c) || Math.abs(c.k) > 0.004
    add(wallStrip({ d: c => d(c) + side * 0.25, y0: 1.05, y1: 3.7, uScale: 1 / 0.9, vScale: 1 / 0.9, side, mask: fenced }), fenceMat, 'none')
    // fence posts
    const posts: Matrix4[] = []
    const m = new Matrix4()
    for (let i = 0; i < count; i += 3) {
      const c = samples[i]
      if (!fenced(c, i)) continue
      const dd = d(c) + side * 0.25
      m.makeTranslation(c.x - c.tz * dd, 2.35, c.z + c.tx * dd)
      posts.push(m.clone())
    }
    const postMesh = new InstancedMesh(new CylinderGeometry(0.05, 0.05, 2.9, 6), steel, posts.length)
    posts.forEach((pm, i) => postMesh.setMatrixAt(i, pm))
    postMesh.matrixAutoUpdate = false
    group.add(postMesh)
  }

  // --- start/finish, grid and pit lane ----------------------------------------
  {
    const chequer = tex(makeChequer(), 1, 12)
    const line = new PlaneGeometry(1.3, HALF * 2 - 0.9)
    line.rotateX(-Math.PI / 2)
    add(place(line, 0, 0.004, 0), mat(new MeshStandardMaterial({
      map: chequer, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    })))
    const marks: BufferGeometry[] = []
    for (let n = 0; n < 12; n++) {
      const x = -30.5 - n * 8, z = n % 2 ? 2.9 : -2.9
      const bar = (w: number, d: number, ox: number, oz: number) => {
        const g = new PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); marks.push(place(g, x + ox, 0.004, z + oz))
      }
      bar(0.16, 2.6, 0, 0); bar(1.3, 0.16, -0.65, -1.3); bar(1.3, 0.16, -0.65, 1.3)
    }
    add(merged(marks), paintWhite)

    // pit lane behind the pit wall
    const laneIn = PIT.wallOffset + 0.7, laneOut = laneIn + PIT.laneWidth
    const inLane: Mask = c => { const r = sRel(c); return r > -PIT.before - 55 && r < PIT.after + 55 }
    add(ribbon({ d0: () => laneIn, d1: () => laneOut + 2.5, y0: 0.003, uScale: 1 / 5, vScale: 1 / 5, mask: inLane }), asphaltPlain)
    add(ribbon({ d0: () => laneIn + 0.3, d1: () => laneIn + 0.45, y0: 0.006, mask: inLane }), paintWhite)
    add(ribbon({ d0: () => laneIn + 4.2, d1: () => laneIn + 4.35, y0: 0.006, mask: inLane }), paintYellow)
    add(ribbon({ d0: () => laneOut - 0.3, d1: () => laneOut - 0.15, y0: 0.006, mask: inLane }), paintWhite)

    // pit building (the straight runs along +X at z = 0, pits on +Z)
    const z0 = laneOut + 2.5, depth = 15, x0 = -PIT.before + 20, x1 = PIT.after - 30, len = x1 - x0
    const garage = tex(makeGarage(), Math.round(len / 11), 1)
    const front = new PlaneGeometry(len, 4.4); front.rotateY(Math.PI)
    add(place(front, (x0 + x1) / 2, 2.2, z0), mat(new MeshStandardMaterial({ map: garage, roughness: 0.6 })), 'receive')
    const shell: BufferGeometry[] = []
    shell.push(place(new BoxGeometry(len, 4.4, depth), (x0 + x1) / 2, 2.2, z0 + depth / 2 + 0.05))
    shell.push(place(new BoxGeometry(len + 3, 0.45, depth + 5), (x0 + x1) / 2, 4.62, z0 + depth / 2 - 1.5)) // balcony slab
    shell.push(place(new BoxGeometry(len + 5, 0.4, depth + 7), (x0 + x1) / 2, 8.9, z0 + depth / 2 - 2)) // roof
    for (let x = x0; x <= x1 + 0.1; x += len / 20) shell.push(place(new BoxGeometry(0.35, 4.2, 0.35), x, 6.8, z0 - 3.6))
    add(merged(shell), whitePanel, 'both')
    add(place(new BoxGeometry(len - 1, 3.6, depth - 1), (x0 + x1) / 2, 6.7, z0 + depth / 2), glass, 'cast')
    const rail = new BoxGeometry(len + 3, 0.06, 0.06)
    add(merged([place(rail.clone(), (x0 + x1) / 2, 5.9, z0 - 3.9), place(rail, (x0 + x1) / 2, 5.4, z0 - 3.9)]), steel, 'none')
    // race control tower
    add(merged([
      place(new BoxGeometry(22, 18, 16), x1 + 20, 9, z0 + 8),
      place(new BoxGeometry(26, 0.6, 20), x1 + 20, 18.3, z0 + 8),
    ]), whitePanel, 'both')
    add(place(new BoxGeometry(22.4, 5, 16.4), x1 + 20, 14.2, z0 + 8), glass, 'none')
    // paddock apron + motorhomes
    const apron = new PlaneGeometry(len + 120, 46); apron.rotateX(-Math.PI / 2)
    const apronUv = apron.attributes.uv as BufferAttribute
    for (let i = 0; i < apronUv.count; i++) apronUv.setXY(i, apronUv.getX(i) * (len + 120) / 5, apronUv.getY(i) * 46 / 5)
    add(place(apron, (x0 + x1) / 2, 0.004, z0 + depth + 23), asphaltPlain)
    const rnd = mulberry32(5)
    const homes: BufferGeometry[] = [], homes2: BufferGeometry[] = []
    for (let x = x0 + 14; x < x1; x += 26) {
      const w = 14 + rnd() * 6
      ;(rnd() > 0.45 ? homes : homes2).push(place(new BoxGeometry(w, 4 + rnd() * 3, 7), x + rnd() * 4, 2.6, z0 + depth + 14 + rnd() * 8))
    }
    add(merged(homes), whitePanel, 'both')
    add(merged(homes2), darkSteel, 'both')
  }

  // --- start lights gantry ----------------------------------------------------
  const lampMats: MeshStandardMaterial[] = []
  {
    const gx = 6
    const zl = -(samples[0].wallL + 0.9), zr = samples[0].wallR + 0.6
    add(merged([
      place(new BoxGeometry(0.5, 7.4, 0.5), gx, 3.7, zl),
      place(new BoxGeometry(0.5, 7.4, 0.5), gx, 3.7, zr),
      place(new BoxGeometry(0.7, 0.9, zr - zl + 0.6), gx, 7.3, (zl + zr) / 2),
      place(new BoxGeometry(0.35, 1.5, 7.2), gx - 0.1, 6.1, 0),
    ]), darkSteel, 'both')
    const banner = new PlaneGeometry(zr - zl - 1, 0.8); banner.rotateY(-Math.PI / 2)
    const bt = makeDecal('CIRCUITO COSTA VERDE', '#ffffff', { w: 2048, h: 96 }); textures.push(bt)
    add(place(banner, gx - 0.36, 7.3, (zl + zr) / 2), mat(new MeshBasicMaterial({ map: bt, transparent: true })), 'none')
    for (let i = 0; i < 5; i++) {
      const lm = new MeshStandardMaterial({ color: '#190404', emissive: new Color('#ff1408'), emissiveIntensity: 0, roughness: 0.3 })
      lampMats.push(lm); materials.push(lm)
      const lamps: BufferGeometry[] = []
      for (const y of [5.75, 6.4]) {
        const disc = new CylinderGeometry(0.24, 0.24, 0.06, 20)
        disc.rotateZ(Math.PI / 2)
        lamps.push(place(disc, gx - 0.3, y, -2.8 + i * 1.4))
      }
      add(merged(lamps), lm, 'none')
    }
  }

  // --- grandstands ------------------------------------------------------------
  {
    const L = 46
    const crowdT = tex(makeCrowd(), 2, 1)
    const crowdMat = mat(new MeshStandardMaterial({ map: crowdT, roughness: 0.9 }))
    const roofMat = mat(new MeshStandardMaterial({ color: '#d9dbde', roughness: 0.5, metalness: 0.3, side: DoubleSide }))
    const seat: BufferGeometry[] = [], struct: BufferGeometry[] = [], roof: BufferGeometry[] = [], trim: BufferGeometry[] = []
    const stands: [number, number][] = [] // [sample index, side]
    for (let k = 0; k < 6; k++) stands.push([indexAtS(-205 + k * 52), -1]) // main straight
    for (const s of [618, 668, 712]) stands.push([indexAtS(s), -1]) // hairpin
    for (const s of [1905, 1960]) stands.push([indexAtS(s), 1]) // S-curves
    for (const s of [2880, 2932]) stands.push([indexAtS(s), -1]) // final corner
    const q = new Quaternion(), mtx = new Matrix4(), one = new Vector3(1, 1, 1), up = new Vector3(0, 1, 0)
    for (const [idx, side] of stands) {
      const p = sidePose(idx, side, 5)
      mtx.compose(new Vector3(p.x, 0, p.z), q.setFromAxisAngle(up, p.yaw), one)
      const rise = 8.4, run = 13, slope = Math.hypot(rise, run)
      const s = new PlaneGeometry(L, slope)
      s.rotateX(-Math.PI / 2 - Math.atan2(rise, run))
      s.translate(0, 1.6 + rise / 2, 1 + run / 2)
      seat.push(s.applyMatrix4(mtx))
      const parts = [
        place(new BoxGeometry(L, 1.6, 0.3), 0, 0.8, 1),
        place(new BoxGeometry(L, 10.4, 0.4), 0, 5.2, 14.3),
        place(new BoxGeometry(0.4, 1.6 + rise / 2, run), -L / 2, (1.6 + rise / 2) / 2, 1 + run / 2),
        place(new BoxGeometry(0.4, 1.6 + rise / 2, run), L / 2, (1.6 + rise / 2) / 2, 1 + run / 2),
      ]
      for (let x = -L / 2 + 1; x <= L / 2; x += (L - 2) / 4) {
        parts.push(place(new BoxGeometry(0.4, 14.2, 0.4), x, 7.1, 14.6))
        const strut = new BoxGeometry(0.25, 0.25, 15.5); strut.rotateX(0.12)
        parts.push(place(strut, x, 13.4, 7.4))
      }
      for (const g of parts) struct.push(g.applyMatrix4(mtx))
      const r = new BoxGeometry(L + 2, 0.18, 16.5); r.rotateX(0.12)
      roof.push(place(r, 0, 13.75, 7.2).applyMatrix4(mtx))
      trim.push(place(new BoxGeometry(L + 2, 0.5, 0.12), 0, 14.65, -0.95).applyMatrix4(mtx))
    }
    add(merged(seat), crowdMat, 'receive')
    add(merged(struct), concrete, 'both')
    add(merged(roof), roofMat, 'both')
    add(merged(trim), mat(new MeshStandardMaterial({ color: '#d7262b', roughness: 0.5 })), 'none')
  }

  // --- billboards, bridge and braking boards ----------------------------------
  {
    const legs: BufferGeometry[] = []
    const boards: [number, number][] = [[430, 1], [540, 1], [900, -1], [1090, 1], [1300, -1], [1560, -1], [1790, 1], [2130, -1], [2420, -1], [2650, -1]]
    boards.forEach(([s, side], n) => {
      const p = sidePose(indexAtS(s), side, 7)
      const bt = makeBillboard(n + 1); bt.anisotropy = opts.anisotropy; textures.push(bt)
      const face = new PlaneGeometry(15, 5.4); face.rotateY(Math.PI)
      add(place(face, 0, 5.6, 0).rotateY(p.yaw).translate(p.x, p.y, p.z), mat(new MeshStandardMaterial({ map: bt, roughness: 0.5 })), 'none')
      legs.push(place(new BoxGeometry(15.3, 5.7, 0.2), 0, 5.6, 0.12).rotateY(p.yaw).translate(p.x, p.y, p.z))
      for (const lx of [-5.5, 5.5]) legs.push(place(new BoxGeometry(0.3, 6, 0.3), lx, 0, 0.3).rotateY(p.yaw).translate(p.x, p.y, p.z))
    })
    // sponsor bridge over the back section
    const bi = indexAtS(1230), c = samples[bi]
    const wl = c.wallL + 1.2, wr = c.wallR + 1.2, yaw = Math.atan2(-c.tz, c.tx)
    const bridge: BufferGeometry[] = [
      place(new BoxGeometry(0.7, 8, 0.7), 0, 4, -wl), place(new BoxGeometry(0.7, 8, 0.7), 0, 4, wr),
      place(new BoxGeometry(1.6, 0.3, wl + wr + 1.4), 0, 6.2, (wr - wl) / 2),
    ]
    for (const g of bridge) legs.push(g.rotateY(yaw).translate(c.x, 0, c.z))
    const bt = makeDecal('APEX GP  ·  VELOX  ·  APEX GP', '#ffffff', { w: 2048, h: 128 }); textures.push(bt)
    const bannerBg = mat(new MeshStandardMaterial({ color: '#b71d22', roughness: 0.5 }))
    const bannerTx = mat(new MeshBasicMaterial({ map: bt, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }))
    for (const dir of [-1, 1]) {
      const bg = new PlaneGeometry(wl + wr, 2); bg.rotateY(dir * Math.PI / 2)
      const g = place(bg, dir * 0.82, 7.3, (wr - wl) / 2).rotateY(yaw).translate(c.x, 0, c.z)
      add(g, bannerBg, 'none'); add(g.clone().translate(0, 0.001, 0), bannerTx, 'none', 1)
    }
    legs.push(place(new BoxGeometry(1.6, 2.1, wl + wr), 0, 7.3, (wr - wl) / 2).rotateY(yaw).translate(c.x, 0, c.z))
    add(merged(legs), darkSteel, 'both')

    // braking distance boards before the hairpin (left side)
    const hair = 596
    ;[150, 100, 50].forEach(dist => {
      const i = indexAtS(hair - dist), cs = samples[i]
      const d = -(HALF + 3.2)
      const t = makeDecal(String(dist), '#111111', { w: 256, h: 128 }); textures.push(t)
      const yawB = Math.atan2(-cs.tz, cs.tx)
      const face = new PlaneGeometry(1.5, 0.75); face.rotateY(-Math.PI / 2)
      const pos = [cs.x - cs.tz * d, cs.z + cs.tx * d]
      const bg = place(new BoxGeometry(0.06, 0.8, 1.55), 0.04, 0.95, 0).rotateY(yawB).translate(pos[0], 0, pos[1])
      add(bg, whitePanel, 'cast')
      add(place(face, 0, 0.95, 0).rotateY(yawB).translate(pos[0], 0, pos[1]), mat(new MeshBasicMaterial({ map: t, transparent: true })), 'none', 1)
    })
  }

  // --- trees ------------------------------------------------------------------
  let treeTotal = 0
  const treeMeshes: InstancedMesh[] = []
  {
    const rnd = mulberry32(99)
    const want = 1500
    let crown = merged([
      place(new IcosahedronGeometry(1, 2).scale(1, 1.15, 1), 0, 1.95, 0),
      place(new IcosahedronGeometry(0.74, 2), 0.6, 1.5, 0.3),
      place(new IcosahedronGeometry(0.7, 2), -0.5, 1.6, -0.4),
      place(new IcosahedronGeometry(0.6, 2), 0.05, 1.45, -0.6),
      place(new IcosahedronGeometry(0.55, 2), -0.1, 2.5, 0.35),
    ])
    // lumpy silhouette
    const cp = crown.attributes.position as BufferAttribute
    for (let i = 0; i < cp.count; i++) {
      const n = 0.86 + 0.28 * hash2(Math.round(cp.getX(i) * 40), Math.round(cp.getY(i) * 40 + cp.getZ(i) * 17))
      cp.setXYZ(i, cp.getX(i) * n, cp.getY(i), cp.getZ(i) * n)
    }
    // weld so the canopy shades smoothly instead of faceted
    crown.deleteAttribute('normal'); crown.deleteAttribute('uv')
    crown = mergeVertices(crown, 1e-3)
    crown.computeVertexNormals()
    const trunk = new CylinderGeometry(0.1, 0.16, 1.4, 6); trunk.translate(0, 0.7, 0)
    const crownMat = mat(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, envMapIntensity: 0.4 }))
    const trunkMat = mat(new MeshStandardMaterial({ color: '#3d2f24', roughness: 0.95 }))
    const crowns = new InstancedMesh(crown, crownMat, want)
    const trunks = new InstancedMesh(trunk, trunkMat, want)
    const o = new Object3D(), col = new Color()
    let n = 0, guard = 0
    while (n < want && guard++ < want * 40) {
      const x = -1150 + rnd() * 2300, z = -560 + rnd() * 1500
      const f = FIELD.sample(x, z)
      const clump = fbm2(x * 0.008 + 40, z * 0.008 + 9)
      if (f.d < 62 || clump < (f.inside ? 0.6 : 0.42)) continue
      if (z > 20 && z < 110 && x > -330 && x < 330) continue // paddock
      const sc = 3.2 + rnd() * 3.4
      o.position.set(x, terrainHeight(x, z) - 0.2, z)
      o.rotation.y = rnd() * 6.28
      o.scale.set(sc * (0.8 + rnd() * 0.4), sc * (0.85 + rnd() * 0.5), sc * (0.8 + rnd() * 0.4))
      o.updateMatrix()
      crowns.setMatrixAt(n, o.matrix); trunks.setMatrixAt(n, o.matrix)
      const v = 0.75 + rnd() * 0.4
      col.setRGB(0.13 * v + rnd() * 0.05, 0.25 * v + rnd() * 0.06, 0.075 * v)
      crowns.setColorAt(n, col)
      n++
    }
    treeTotal = n
    treeMeshes.push(crowns, trunks)
    crowns.count = trunks.count = Math.round(n * opts.detail)
    crowns.castShadow = true; crowns.receiveShadow = true
    crowns.matrixAutoUpdate = trunks.matrixAutoUpdate = false
    crowns.frustumCulled = trunks.frustumCulled = false
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true
    group.add(crowns, trunks)
  }

  group.updateMatrixWorld(true)

  return {
    group,
    setStartLights(n) {
      lampMats.forEach((m, i) => { m.emissiveIntensity = i < n ? 9 : 0 })
    },
    applyQuality(anisotropy, detail) {
      for (const t of textures) { if (t.anisotropy !== anisotropy) { t.anisotropy = anisotropy; t.needsUpdate = true } }
      for (const m of treeMeshes) m.count = Math.round(treeTotal * detail)
    },
    dispose() {
      group.traverse(o => { const m = o as Mesh; if (m.isMesh) m.geometry.dispose() })
      materials.forEach(m => m.dispose())
      textures.forEach(t => t.dispose())
    },
  }
}
