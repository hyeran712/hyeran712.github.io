/**
 * Procedural PBR textures, generated once on canvases at load time.
 * No external image assets are required (see ASSETS.md).
 */
import {
  CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, NoColorSpace, type Texture,
} from 'three'

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Tileable value noise on a size x size grid with `cells` lattice cells. */
function tileNoise(size: number, cells: number, seed: number): Float32Array {
  const rnd = mulberry32(seed)
  const lattice = new Float32Array(cells * cells)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rnd()
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells
    const y0 = Math.floor(fy), ty = fy - y0
    const sy = ty * ty * (3 - 2 * ty)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells
      const x0 = Math.floor(fx), tx = fx - x0
      const sx = tx * tx * (3 - 2 * tx)
      const a = lattice[(y0 % cells) * cells + (x0 % cells)]
      const b = lattice[(y0 % cells) * cells + ((x0 + 1) % cells)]
      const c = lattice[((y0 + 1) % cells) * cells + (x0 % cells)]
      const d = lattice[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)]
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
    }
  }
  return out
}

function fbm(size: number, baseCells: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size)
  let amp = 1, total = 0
  for (let o = 0; o < octaves; o++) {
    const n = tileNoise(size, Math.min(size, baseCells << o), seed + o * 101)
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp
    total += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c
}

function finish(c: HTMLCanvasElement, srgb: boolean, repeat = true, aniso = 8): CanvasTexture {
  const t = new CanvasTexture(c)
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = aniso
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  return t
}

/** Build colour + normal + roughness from a height field. */
function fromHeight(
  size: number,
  height: Float32Array,
  colour: (h: number, i: number) => [number, number, number],
  rough: (h: number, i: number) => number,
  normalStrength: number,
) {
  const cc = canvas(size, size), nc = canvas(size, size), rc = canvas(size, size)
  const cctx = cc.getContext('2d')!, nctx = nc.getContext('2d')!, rctx = rc.getContext('2d')!
  const ci = cctx.createImageData(size, size), ni = nctx.createImageData(size, size), ri = rctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const h = height[i]
      const hx = height[y * size + ((x + 1) % size)] - height[y * size + ((x - 1 + size) % size)]
      const hy = height[((y + 1) % size) * size + x] - height[((y - 1 + size) % size) * size + x]
      let nx = -hx * normalStrength, ny = -hy * normalStrength, nz = 1
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l
      const [r, g, b] = colour(h, i)
      const o = i * 4
      ci.data[o] = r; ci.data[o + 1] = g; ci.data[o + 2] = b; ci.data[o + 3] = 255
      ni.data[o] = (nx * 0.5 + 0.5) * 255; ni.data[o + 1] = (ny * 0.5 + 0.5) * 255; ni.data[o + 2] = (nz * 0.5 + 0.5) * 255; ni.data[o + 3] = 255
      const rr = Math.max(0, Math.min(1, rough(h, i))) * 255
      // glTF convention: roughness in G, metalness in B
      ri.data[o] = 255; ri.data[o + 1] = rr; ri.data[o + 2] = 0; ri.data[o + 3] = 255
    }
  }
  cctx.putImageData(ci, 0, 0); nctx.putImageData(ni, 0, 0); rctx.putImageData(ri, 0, 0)
  return { map: finish(cc, true), normalMap: finish(nc, false), roughnessMap: finish(rc, false) }
}

export interface PBRSet { map: Texture; normalMap: Texture; roughnessMap: Texture }

export function makeAsphalt(size = 1024): PBRSet {
  const rnd = mulberry32(7)
  // aggregate: lots of small stones of varying brightness in dark bitumen
  const stones = new Float32Array(size * size)
  const tone = new Float32Array(size * size)
  const count = Math.floor(size * size * 0.09)
  for (let n = 0; n < count; n++) {
    const cx = rnd() * size, cy = rnd() * size
    const r = 0.7 + rnd() * rnd() * 1.9
    const bright = 0.2 + rnd() * rnd() * 0.8
    const hgt = 0.5 + rnd() * 0.5
    const ir = Math.ceil(r)
    for (let dy = -ir; dy <= ir; dy++) for (let dx = -ir; dx <= ir; dx++) {
      const d = Math.hypot(dx, dy) / r
      if (d > 1) continue
      const x = (Math.floor(cx) + dx + size) % size, y = (Math.floor(cy) + dy + size) % size
      const i = y * size + x
      const v = hgt * (1 - d * d)
      if (v > stones[i]) { stones[i] = v; tone[i] = bright }
    }
  }
  const macro = fbm(size, 4, 4, 11)
  const fine = tileNoise(size, size / 2, 5)
  return fromHeight(
    size,
    stones,
    (h, i) => {
      const base = 58 + macro[i] * 14 + fine[i] * 8
      const s = h > 0.05 ? tone[i] * 30 * Math.min(1, h * 1.6) : 0
      const v = base + s
      return [v * 0.97, v * 0.985, v * 1.02]
    },
    (h, i) => 0.92 - h * 0.22 - macro[i] * 0.08,
    2.2,
  )
}

export function makeGravel(size = 512): PBRSet {
  const n1 = tileNoise(size, size / 3, 21)
  const n2 = tileNoise(size, size / 7, 22)
  const macro = fbm(size, 4, 3, 23)
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) h[i] = n1[i] * 0.6 + n2[i] * 0.4
  return fromHeight(
    size, h,
    (hv, i) => {
      const v = 0.62 + hv * 0.5 + macro[i] * 0.16
      return [176 * v, 163 * v, 140 * v]
    },
    () => 0.96,
    5,
  )
}

export function makeGrass(size = 512): PBRSet {
  const n1 = tileNoise(size, size / 2, 31)
  const n2 = fbm(size, 8, 5, 32)
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) h[i] = n1[i] * 0.5 + n2[i] * 0.5
  return fromHeight(
    size, h,
    (hv, i) => {
      const v = 0.72 + hv * 0.42
      const dry = n2[i]
      return [(58 + dry * 20) * v, (96 + dry * 12) * v, (34 + dry * 6) * v]
    },
    () => 0.93,
    2,
  )
}

export function makeConcrete(size = 512): PBRSet {
  const n = fbm(size, 6, 6, 41)
  const fine = tileNoise(size, size / 2, 42)
  const h = new Float32Array(size * size)
  for (let i = 0; i < h.length; i++) h[i] = n[i] * 0.7 + fine[i] * 0.3
  return fromHeight(
    size, h,
    (hv) => { const v = 150 + hv * 62; return [v, v * 0.99, v * 0.96] },
    (hv) => 0.8 + hv * 0.15,
    0.5,
  )
}

/** Red/white kerb paint, slightly worn. One repeat = one red + one white block. */
export function makeCurb(): Texture {
  const w = 256, h = 512
  const c = canvas(w, h), ctx = c.getContext('2d')!
  ctx.fillStyle = '#c8161d'; ctx.fillRect(0, 0, w, h / 2)
  ctx.fillStyle = '#e9e9e4'; ctx.fillRect(0, h / 2, w, h / 2)
  const rnd = mulberry32(51)
  // tyre scuffing and grime
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * 0.07
    ctx.fillStyle = `rgba(20,20,22,${a})`
    ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 40, 1 + rnd() * 2)
  }
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.25, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.12)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  return finish(c, true)
}

/** 2x2 twill carbon-fibre weave: colour + normal. */
export function makeCarbon(size = 256) {
  const cells = 16
  const cs = size / cells
  const h = new Float32Array(size * size)
  const col = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = Math.floor(x / cs), cy = Math.floor(y / cs)
    const warp = ((cx + cy) & 3) < 2
    const u = (x % cs) / cs, v = (y % cs) / cs
    // each tow is a rounded ridge running along its direction
    const across = warp ? u : v
    h[y * size + x] = Math.sin(across * Math.PI) * 0.8 + (warp ? 0.1 : 0)
    col[y * size + x] = warp ? 0.9 : 0.55
  }
  const out = fromHeight(
    size, h,
    (hv, i) => { const v = 10 + col[i] * 13 + hv * 6; return [v, v, v * 1.05] },
    (hv, i) => 0.62 + (1 - col[i]) * 0.16,
    1.6,
  )
  return out
}

/** Tyre texture. u wraps around the wheel, v runs across the profile (sidewall-tread-sidewall). */
export function makeTyre() {
  const w = 2048, h = 512
  const c = canvas(w, h), ctx = c.getContext('2d')!
  ctx.fillStyle = '#161617'; ctx.fillRect(0, 0, w, h)
  const rnd = mulberry32(61)
  // tread band (middle 44%): scrubbed, slightly lighter, with circumferential streaks
  const t0 = h * 0.28, t1 = h * 0.72
  ctx.fillStyle = '#1d1d1e'; ctx.fillRect(0, t0, w, t1 - t0)
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? '70,70,72' : '0,0,0'},${rnd() * 0.1})`
    ctx.fillRect(rnd() * w, t0 + rnd() * (t1 - t0), 30 + rnd() * 260, 1 + rnd() * 3)
  }
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = `rgba(90,90,92,${rnd() * 0.13})`
    ctx.fillRect(rnd() * w, t0 + rnd() * (t1 - t0), 2, 2)
  }
  // sidewalls: compound stripe + lettering (fictional supplier)
  const drawSide = (yc: number, flip: boolean) => {
    ctx.fillStyle = '#d7262b'
    ctx.fillRect(0, yc - 34, w, 7)
    ctx.fillRect(0, yc + 27, w, 7)
    ctx.save()
    ctx.font = '700 42px "Arial Narrow", Arial, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    for (let k = 0; k < 4; k++) {
      ctx.save()
      ctx.translate((k + 0.5) * (w / 4), yc)
      if (flip) ctx.scale(1, -1)
      ctx.fillStyle = k % 2 ? '#d7262b' : '#e8e8e8'
      ctx.fillText(k % 2 ? 'S O F T' : 'V E L O X', 0, 2)
      ctx.restore()
    }
    ctx.restore()
  }
  drawSide(h * 0.135, false)
  drawSide(h * 0.865, true)
  const map = finish(c, true)
  map.wrapT = RepeatWrapping
  return map
}

const SPONSORS: { name: string; bg: string; fg: string; font?: string }[] = [
  { name: 'VELOX', bg: '#d7262b', fg: '#ffffff' },
  { name: 'NORDWIND', bg: '#0c2a52', fg: '#e8f1ff' },
  { name: 'kairos energy', bg: '#f2c318', fg: '#151515' },
  { name: 'HELIX', bg: '#f4f4f2', fg: '#0d0d0d' },
  { name: 'ORBITAL', bg: '#101012', fg: '#28e0b0' },
  { name: 'Costa Verde', bg: '#0f6b46', fg: '#f6f2df' },
  { name: 'APEX GP', bg: '#f4f4f2', fg: '#d7262b' },
  { name: 'MERIDIAN', bg: '#5a1fa8', fg: '#ffffff' },
]

/** Strip of fictional trackside sponsor boards, 8 panels wide. */
export function makeAdStrip(): Texture {
  const pw = 512, ph = 128
  const c = canvas(pw * SPONSORS.length, ph), ctx = c.getContext('2d')!
  SPONSORS.forEach((s, i) => {
    ctx.fillStyle = s.bg; ctx.fillRect(i * pw, 0, pw, ph)
    ctx.fillStyle = s.fg
    ctx.font = `italic 800 ${s.name.length > 9 ? 62 : 82}px "Helvetica Neue", Arial, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(s.name, i * pw + pw / 2, ph / 2 + 4)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(i * pw, 0, 3, ph)
  })
  // light weathering
  const rnd = mulberry32(71)
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(30,30,30,${rnd() * 0.05})`
    ctx.fillRect(rnd() * c.width, rnd() * ph, 1 + rnd() * 3, 4 + rnd() * 30)
  }
  return finish(c, true)
}

export function makeBillboard(index: number): Texture {
  const s = SPONSORS[index % SPONSORS.length]
  const c = canvas(1024, 384), ctx = c.getContext('2d')!
  ctx.fillStyle = s.bg; ctx.fillRect(0, 0, 1024, 384)
  ctx.fillStyle = s.fg
  ctx.font = `italic 800 ${s.name.length > 9 ? 150 : 210}px "Helvetica Neue", Arial, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(s.name, 512, 200)
  return finish(c, true, false)
}

/** Grandstand crowd: rows of seats, most of them occupied. */
export function makeCrowd(): Texture {
  const w = 1024, h = 512
  const c = canvas(w, h), ctx = c.getContext('2d')!
  ctx.fillStyle = '#3a3d44'; ctx.fillRect(0, 0, w, h)
  const rnd = mulberry32(81)
  const rows = 18, cols = 110
  const shirts = ['#d7262b', '#f2f2f2', '#1b4fa0', '#f2c318', '#222', '#e87a1c', '#2c8a4e', '#b9c2cc', '#7a1d1d', '#ffffff']
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.15) * (h / rows)
    ctx.fillStyle = r % 2 ? '#2b2e35' : '#30333a'
    ctx.fillRect(0, y - 3, w, h / rows)
    for (let k = 0; k < cols; k++) {
      const x = (k + 0.5) * (w / cols) + (rnd() - 0.5) * 2
      if (rnd() < 0.14) { // empty seat
        ctx.fillStyle = '#1e5fa8'; ctx.fillRect(x - 3, y + 6, 6, 10); continue
      }
      ctx.fillStyle = shirts[Math.floor(rnd() * shirts.length)]
      ctx.fillRect(x - 3.4, y + 7, 6.8, 13)
      const skin = 150 + rnd() * 90
      ctx.fillStyle = `rgb(${skin},${skin * 0.8},${skin * 0.66})`
      ctx.beginPath(); ctx.arc(x, y + 4, 2.9, 0, 6.3); ctx.fill()
      if (rnd() < 0.3) { ctx.fillStyle = shirts[Math.floor(rnd() * shirts.length)]; ctx.fillRect(x - 3, y, 6, 2.4) }
    }
  }
  return finish(c, true)
}

/** Chain-link catch fence with alpha. */
export function makeFence(): Texture {
  const s = 128
  const c = canvas(s, s), ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, s, s)
  ctx.strokeStyle = 'rgba(175,180,186,1)'
  ctx.lineWidth = 3.2
  const n = 4, d = s / n
  for (let i = -n; i <= n * 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * d, 0); ctx.lineTo(i * d + s, s); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(i * d, 0); ctx.lineTo(i * d - s, s); ctx.stroke()
  }
  const t = finish(c, true)
  return t
}

/** Pit building ground floor: a row of garage doors. One repeat = one garage. */
export function makeGarage(): Texture {
  const w = 512, h = 256
  const c = canvas(w, h), ctx = c.getContext('2d')!
  ctx.fillStyle = '#c9cbcf'; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#16171a'; ctx.fillRect(40, 44, w - 80, h - 44)
  // interior glow and floor
  const g = ctx.createLinearGradient(0, 44, 0, h)
  g.addColorStop(0, '#0b0c0e'); g.addColorStop(0.6, '#25272b'); g.addColorStop(1, '#3c3f45')
  ctx.fillStyle = g; ctx.fillRect(48, 52, w - 96, h - 52)
  ctx.fillStyle = '#e9edf2'; ctx.fillRect(70, 58, w - 140, 7) // strip light
  ctx.fillStyle = '#d7262b'; ctx.fillRect(0, 22, w, 12)
  ctx.fillStyle = '#8b8e94'; ctx.fillRect(0, 0, 6, h)
  // equipment silhouettes
  ctx.fillStyle = '#4a4d55'; ctx.fillRect(80, 150, 70, 106); ctx.fillRect(360, 170, 80, 86)
  ctx.fillStyle = '#d7262b'; ctx.fillRect(84, 158, 62, 10)
  return finish(c, true)
}

/** Stacked tyre barrier with a painted band. One repeat = 1 tyre wide. */
export function makeTyreWall(): Texture {
  const w = 128, h = 256
  const c = canvas(w, h), ctx = c.getContext('2d')!
  ctx.fillStyle = '#0c0c0d'; ctx.fillRect(0, 0, w, h)
  const rows = 5
  for (let r = 0; r < rows; r++) {
    const y0 = (r * h) / rows, rh = h / rows
    const g = ctx.createLinearGradient(0, y0, 0, y0 + rh)
    const painted = r === 1 || r === 3
    const base = painted ? (r === 1 ? [215, 38, 43] : [235, 235, 232]) : [62, 62, 66]
    g.addColorStop(0, `rgb(${base.map(v => v * 0.6).join(',')})`)
    g.addColorStop(0.45, `rgb(${base.join(',')})`)
    g.addColorStop(1, `rgb(${base.map(v => v * 0.3).join(',')})`)
    ctx.fillStyle = g
    ctx.fillRect(0, y0 + 2, w, rh - 4)
    const gx = ctx.createLinearGradient(0, 0, w, 0)
    gx.addColorStop(0, 'rgba(0,0,0,0.75)'); gx.addColorStop(0.22, 'rgba(0,0,0,0)'); gx.addColorStop(0.78, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,0.75)')
    ctx.fillStyle = gx; ctx.fillRect(0, y0, w, rh)
  }
  return finish(c, true)
}

/** Chequered start/finish band. */
export function makeChequer(): Texture {
  const c = canvas(64, 64), ctx = c.getContext('2d')!
  ctx.fillStyle = '#e8e8e6'; ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 32, 32); ctx.fillRect(32, 32, 32, 32)
  const t = finish(c, true)
  return t
}

/** Soft radial blob used as a contact shadow under the car. */
export function makeBlob(): Texture {
  const c = canvas(256, 128), ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(128, 64, 4, 128, 64, 64)
  g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.55, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.save(); ctx.scale(2, 1); ctx.translate(-64, 0)
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128); ctx.restore()
  return finish(c, true, false)
}

/** Text decal with transparent background (car numbers, logos). */
export function makeDecal(text: string, color: string, opts: { w?: number; h?: number; font?: string } = {}): Texture {
  const w = opts.w ?? 512, h = opts.h ?? 128
  const c = canvas(w, h), ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = color
  ctx.font = opts.font ?? `italic 800 ${Math.floor(h * 0.74)}px "Helvetica Neue", Arial, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + h * 0.04)
  return finish(c, true, false)
}

/** Paint livery for lofted bodywork. u: nose -> tail, v: around the section (0.5 = top). */
export function makeLivery(primary: string, accent: string, dark: string): Texture {
  const w = 1024, h = 512
  const c = canvas(w, h), ctx = c.getContext('2d')!
  ctx.fillStyle = primary; ctx.fillRect(0, 0, w, h)
  // carbon-black lower body and tail fade
  const g = ctx.createLinearGradient(0, 0, w, 0)
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(0.9, dark)
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = dark
  ctx.fillRect(0, 0, w, h * 0.13); ctx.fillRect(0, h * 0.87, w, h * 0.13)
  // symmetric accent swooshes (mirror about v = 0.5)
  const swoosh = (v: number, th: number, col: string) => {
    for (const sgn of [-1, 1]) {
      ctx.beginPath()
      const y = (u: number) => (0.5 + sgn * (v + 0.1 * Math.sin(u * 2.4))) * h
      ctx.moveTo(0, y(0))
      for (let u = 0; u <= 1.001; u += 0.02) ctx.lineTo(u * w, y(u))
      for (let u = 1; u >= -0.001; u -= 0.02) ctx.lineTo(u * w, y(u) + sgn * th * h * (0.4 + u))
      ctx.closePath(); ctx.fillStyle = col; ctx.fill()
    }
  }
  swoosh(0.2, 0.035, accent)
  swoosh(0.275, 0.012, '#f2f2f2')
  // nose tip
  ctx.fillStyle = accent; ctx.fillRect(0, 0, w * 0.035, h)
  return finish(c, true, false)
}

/** Soft, tileable cumulus layer (white with alpha). */
export function makeClouds(size = 1024): Texture {
  const n = fbm(size, 4, 6, 201)
  const n2 = fbm(size, 2, 3, 202)
  const c = canvas(size, size), ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x
    const v = n[i] * 0.7 + n2[i] * 0.3
    let a = Math.max(0, Math.min(1, (v - 0.53) / 0.14))
    a = a * a * (3 - 2 * a)
    const shade = 232 + Math.min(23, Math.max(0, (v - 0.53) * 160))
    img.data[i * 4] = shade; img.data[i * 4 + 1] = shade; img.data[i * 4 + 2] = Math.min(255, shade + 5)
    img.data[i * 4 + 3] = a * 240
  }
  ctx.putImageData(img, 0, 0)
  return finish(c, true, true, 4)
}
