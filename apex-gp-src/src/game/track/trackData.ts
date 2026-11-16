/**
 * Circuit definition for "Circuito Costa Verde" (fictional).
 *
 * Everything gameplay-related about the track lives here and has no rendering
 * or DOM dependency, so the physics / lap timing can be simulated headlessly
 * (see scripts/simTest.ts).
 *
 * Conventions: the world is Y-up and the circuit is flat (y = 0).
 *   tangent  t = (tx, tz)      direction of travel
 *   right    r = (-tz, tx)     points to the driver's right
 *   lateral offset d > 0  =>   right of the centre line
 *   curvature k > 0       =>   right-hand corner
 */
import { CatmullRomCurve3, Vector3 } from 'three'

export const TRACK_HALF_WIDTH = 7.5
export const CURB_WIDTH = 1.6
export const SAMPLE_SPACING = 2

/** Closed-loop control points (x, z) in metres. */
const CONTROL_POINTS: [number, number][] = [
  [-480, 0], [-240, 0], [0, 0], [240, 0], [470, 0], [560, 0],
  // T1-T2: tight hairpin
  [612, 9], [634, 46], [612, 83], [560, 92],
  [480, 96],
  // T3: fast left sweeper
  [380, 108], [296, 150], [248, 232], [236, 320],
  // T4: long right
  [200, 408], [112, 452], [10, 436],
  // T5-T8: S-curves
  [-82, 388], [-168, 420], [-254, 384], [-340, 420], [-430, 404],
  // T9-T10: fast right sweeps back to the main straight
  [-540, 350], [-628, 262], [-664, 150], [-640, 58], [-572, 8],
]

export interface TrackSample {
  x: number
  z: number
  tx: number
  tz: number
  /** distance along the lap, metres */
  s: number
  /** signed curvature (1/m), positive = right-hander */
  k: number
  /** distance from centre line to the barrier on each side */
  wallL: number
  wallR: number
  curbL: boolean
  curbR: boolean
  /** gravel trap present on that side (starts GRAVEL_START from the centre) */
  gravelL: boolean
  gravelR: boolean
}

export const GRAVEL_START = TRACK_HALF_WIDTH + CURB_WIDTH + 2.4
export const GRAVEL_END_MARGIN = 1.2

/** Pit straight is the stretch around s = 0; these are distances along the lap. */
export const PIT = {
  /** pit wall begins this far before the start line */
  before: 250,
  /** and ends this far after it */
  after: 260,
  wallOffset: TRACK_HALF_WIDTH + 1.6,
  laneWidth: 11,
}

export interface Track {
  samples: TrackSample[]
  length: number
  count: number
  /** index of the start/finish line sample (always 0) */
  startIndex: number
}

function smooth(values: number[], radius: number): number[] {
  const n = values.length
  const out = new Array<number>(n)
  // sliding-window mean on a ring
  let sum = 0
  for (let j = -radius; j <= radius; j++) sum += values[(j + n) % n]
  for (let i = 0; i < n; i++) {
    out[i] = sum / (2 * radius + 1)
    sum += values[(i + radius + 1) % n] - values[(i - radius + n) % n]
  }
  return out
}

function buildTrack(): Track {
  const curve = new CatmullRomCurve3(
    CONTROL_POINTS.map(([x, z]) => new Vector3(x, 0, z)),
    true,
    'centripetal',
  )
  curve.arcLengthDivisions = 6000
  const rawLength = curve.getLength()
  const count = Math.round(rawLength / SAMPLE_SPACING)

  // Start line: where the centre line crosses x = 0 on the main straight.
  // Points are uniformly spaced by arc length; find the one closest to the origin.
  const pts: Vector3[] = []
  for (let i = 0; i < count; i++) pts.push(curve.getPointAt(i / count))
  let start = 0
  let best = Infinity
  for (let i = 0; i < count; i++) {
    const d = pts[i].x * pts[i].x + pts[i].z * pts[i].z
    if (d < best) { best = d; start = i }
  }

  const P = (i: number) => pts[(((i + start) % count) + count) % count]
  const samples: TrackSample[] = []
  let s = 0
  for (let i = 0; i < count; i++) {
    const p = P(i)
    const a = P(i - 1)
    const b = P(i + 1)
    let tx = b.x - a.x
    let tz = b.z - a.z
    const len = Math.hypot(tx, tz)
    tx /= len
    tz /= len
    samples.push({
      x: p.x, z: p.z, tx, tz, s, k: 0,
      wallL: 0, wallR: 0, curbL: false, curbR: false, gravelL: false, gravelR: false,
    })
    s += Math.hypot(b.x - p.x, b.z - p.z)
  }
  const length = s

  // Signed curvature from the change of tangent.
  let kRaw: number[] = []
  for (let i = 0; i < count; i++) {
    const a = samples[(i - 1 + count) % count]
    const b = samples[(i + 1) % count]
    const c = samples[i]
    const dtx = b.tx - a.tx
    const dtz = b.tz - a.tz
    const ds = 2 * SAMPLE_SPACING
    kRaw.push((dtx * -c.tz + dtz * c.tx) / ds)
  }
  kRaw = smooth(kRaw, 3)
  for (let i = 0; i < count; i++) samples[i].k = kRaw[i]

  // Runoff: generous on the outside of corners (especially in the braking zone
  // before them), tight elsewhere.
  const lookAhead = Math.round(130 / SAMPLE_SPACING)
  const lookBehind = Math.round(30 / SAMPLE_SPACING)
  let extraL: number[] = []
  let extraR: number[] = []
  for (let i = 0; i < count; i++) {
    let maxR = 0 // strongest right-hander nearby -> runoff on the LEFT
    let maxL = 0
    for (let j = -lookBehind; j <= lookAhead; j++) {
      const k = samples[(i + j + count) % count].k
      // weight: corners further ahead matter a little less
      const w = j > 0 ? 1 - (j / lookAhead) * 0.35 : 1
      if (k > 0) maxR = Math.max(maxR, k * w)
      else maxL = Math.max(maxL, -k * w)
    }
    extraL.push(Math.min(30, maxR * 1050))
    extraR.push(Math.min(30, maxL * 1050))
  }
  extraL = smooth(smooth(extraL, 14), 14)
  extraR = smooth(smooth(extraR, 14), 14)

  const base = TRACK_HALF_WIDTH + 6.5
  let wallL: number[] = []
  let wallR: number[] = []
  for (let i = 0; i < count; i++) {
    const c = samples[i]
    let l = base + extraL[i]
    let r = base + extraR[i]
    // Pit straight: pit wall close on the right, grandstand wall on the left.
    const sRel = c.s > length / 2 ? c.s - length : c.s
    if (sRel > -PIT.before && sRel < PIT.after) r = PIT.wallOffset
    if (sRel > -PIT.before - 80 && sRel < PIT.after + 40) l = Math.min(l, TRACK_HALF_WIDTH + 4.5)
    // Never let the inside offset approach the corner radius (would self-intersect).
    const radius = 1 / Math.max(1e-6, Math.abs(c.k))
    const inner = Math.max(TRACK_HALF_WIDTH + 3.5, radius * 0.5)
    if (c.k > 0.002) r = Math.min(r, inner)
    else if (c.k < -0.002) l = Math.min(l, inner)
    wallL.push(l)
    wallR.push(r)
  }
  wallL = smooth(smooth(wallL, 12), 8)
  wallR = smooth(smooth(wallR, 12), 8)
  for (let i = 0; i < count; i++) {
    const c = samples[i]
    const radius = 1 / Math.max(1e-6, Math.abs(c.k))
    const hard = Math.max(TRACK_HALF_WIDTH + 2.5, radius * 0.75)
    if (c.k > 0) wallR[i] = Math.min(wallR[i], hard)
    else wallL[i] = Math.min(wallL[i], hard)
    c.wallL = wallL[i]
    c.wallR = wallR[i]
    c.gravelL = wallL[i] - GRAVEL_START > 7
    c.gravelR = wallR[i] - GRAVEL_START > 7
  }

  // Curbs wherever the track is meaningfully curved, dilated a little.
  const dil = Math.round(16 / SAMPLE_SPACING)
  for (let i = 0; i < count; i++) {
    let m = 0
    for (let j = -dil; j <= dil; j++) m = Math.max(m, Math.abs(samples[(i + j + count) % count].k))
    const curved = m > 0.0042
    samples[i].curbL = curved
    samples[i].curbR = curved
  }

  return { samples, length, count, startIndex: 0 }
}

export const track: Track = buildTrack()

export interface TrackLocation {
  /** nearest sample index */
  index: number
  /** signed lateral offset from the centre line (right positive) */
  d: number
  /** distance along the lap in metres (continuous) */
  s: number
}

/**
 * Locate a world position relative to the centre line.
 * Pass the previous index as `hint` for an O(1) local search; pass -1 for a
 * full search (used on reset).
 */
export function locate(x: number, z: number, hint: number, out?: TrackLocation): TrackLocation {
  const { samples, count } = track
  let bestI = 0
  let best = Infinity
  if (hint < 0) {
    for (let i = 0; i < count; i++) {
      const c = samples[i]
      const d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z)
      if (d < best) { best = d; bestI = i }
    }
  } else {
    const win = 30
    for (let j = -win; j <= win; j++) {
      const i = (hint + j + count) % count
      const c = samples[i]
      const d = (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z)
      if (d < best) { best = d; bestI = i }
    }
  }
  const c = samples[bestI]
  const dx = x - c.x
  const dz = z - c.z
  const along = dx * c.tx + dz * c.tz
  const d = dx * -c.tz + dz * c.tx
  const res = out ?? { index: 0, d: 0, s: 0 }
  res.index = bestI
  res.d = d
  let s = c.s + along
  if (s < 0) s += track.length
  if (s >= track.length) s -= track.length
  res.s = s
  return res
}

export type Surface = 'asphalt' | 'curb' | 'grass' | 'gravel'

/** Surface under a point given its track location. */
export function surfaceAt(loc: TrackLocation): Surface {
  const c = track.samples[loc.index]
  const a = Math.abs(loc.d)
  if (a <= TRACK_HALF_WIDTH) return 'asphalt'
  const right = loc.d > 0
  // The pit lane (behind the pit wall) is asphalt too, should a car ever get there.
  if ((right ? c.curbR : c.curbL) && a <= TRACK_HALF_WIDTH + CURB_WIDTH) return 'curb'
  if (right ? c.gravelR : c.gravelL) {
    const wall = right ? c.wallR : c.wallL
    if (a > GRAVEL_START && a < wall - GRAVEL_END_MARGIN) return 'gravel'
  }
  return 'grass'
}

/** World position + heading for a point on the track (used for grid/reset). */
export function poseAt(index: number, lateral = 0) {
  const c = track.samples[((index % track.count) + track.count) % track.count]
  return {
    x: c.x + -c.tz * lateral,
    z: c.z + c.tx * lateral,
    // yaw such that local +X (car forward) maps onto the tangent
    yaw: Math.atan2(-c.tz, c.tx),
  }
}
