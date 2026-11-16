/**
 * Time-trial lap logic: start/finish detection, ordered checkpoints and
 * validity. Pure logic, no rendering.
 *
 * The lap is divided into NUM_SECTORS equal gates along the centre line.
 * A lap only counts if every gate was crossed in order, in the forward
 * direction, and the car never left the circuit with all four wheels.
 */
import { track } from '../track/trackData'

export const NUM_CHECKPOINTS = 10
const STORAGE_KEY = 'apex-gp:best-lap:v1'

export interface LapEvent {
  type: 'lap' | 'invalidated' | 'checkpoint' | 'start'
  lapTime?: number
  valid?: boolean
  isBest?: boolean
  reason?: string
  checkpoint?: number
}

export interface BestLap {
  time: number
  /** time at each checkpoint, for the live delta */
  splits: number[]
  date: string
}

export function loadBest(): BestLap | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const b = JSON.parse(raw)
    if (typeof b?.time === 'number' && b.time > 5 && Array.isArray(b.splits)) return b
  } catch { /* ignore corrupt storage */ }
  return null
}

function saveBest(b: BestLap) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(b)) } catch { /* storage unavailable */ }
}

export function clearBest() {
  try { globalThis.localStorage?.removeItem(STORAGE_KEY) } catch { /* noop */ }
}

export class LapTimer {
  /** 0 = out-lap (before first crossing of the line) */
  lap = 0
  lapTime = 0
  lastLap: number | null = null
  lastLapValid = true
  best: BestLap | null = loadBest()
  valid = true
  invalidReason = ''
  /** next checkpoint index expected (1..NUM-1, then 0 = finish line) */
  nextCheckpoint = 1
  /** live delta vs. best at the last checkpoint (s), null if unknown */
  delta: number | null = null
  private splits: number[] = []
  private prevS = 0
  private offTime = 0
  private events: LapEvent[] = []

  reset(s: number) {
    this.lap = 0
    this.lapTime = 0
    this.lastLap = null
    this.valid = true
    this.invalidReason = ''
    this.nextCheckpoint = 1
    this.delta = null
    this.splits = []
    this.prevS = s
    this.offTime = 0
    this.events.length = 0
    this.best = loadBest()
  }

  invalidate(reason: string) {
    if (this.lap > 0 && this.valid) {
      this.valid = false
      this.invalidReason = reason
      this.events.push({ type: 'invalidated', reason })
    }
  }

  /** Drain queued events (lap completed, invalidated, ...). */
  poll(): LapEvent | undefined {
    return this.events.shift()
  }

  /**
   * @param s        distance along the lap (m)
   * @param wheelsOff number of wheels on grass/gravel
   * @param vx       forward speed (to reject reversing over the line)
   */
  update(dt: number, s: number, wheelsOff: number, vx: number) {
    const L = track.length
    if (this.lap > 0) this.lapTime += dt

    // signed progress this step, unwrapped around the lap boundary
    let ds = s - this.prevS
    if (ds > L / 2) ds -= L
    else if (ds < -L / 2) ds += L

    // track limits: all four wheels off for more than a moment
    if (wheelsOff === 4) {
      this.offTime += dt
      if (this.offTime > 0.25) this.invalidate('TRACK LIMITS')
    } else this.offTime = 0

    const gate = L / NUM_CHECKPOINTS
    if (ds > 0) {
      const wrapped = s < this.prevS // crossed s = 0 going forward
      // intermediate checkpoints
      if (this.nextCheckpoint !== 0) {
        const gs = this.nextCheckpoint * gate
        if (!wrapped && this.prevS < gs && s >= gs) {
          this.splits[this.nextCheckpoint] = this.lapTime
          if (this.lap > 0 && this.valid && this.best?.splits[this.nextCheckpoint] != null) {
            this.delta = this.lapTime - this.best.splits[this.nextCheckpoint]
          }
          this.events.push({ type: 'checkpoint', checkpoint: this.nextCheckpoint })
          this.nextCheckpoint = (this.nextCheckpoint + 1) % NUM_CHECKPOINTS
        }
      }
      if (wrapped && vx > 0) this.crossLine(L - this.prevS, ds, dt)
    } else if (ds < 0 && s > this.prevS) {
      // crossed the line backwards: whatever lap is running cannot count,
      // and all checkpoints must be collected again.
      this.invalidate('WRONG WAY')
      this.nextCheckpoint = 1
    }
    this.prevS = s
  }

  private crossLine(distBefore: number, ds: number, dt: number) {
    // sub-step interpolation so lap times are not quantised to the tick
    const frac = ds > 1e-6 ? Math.min(1, Math.max(0, distBefore / ds)) : 0
    const overshoot = dt * (1 - frac)
    if (this.lap === 0) {
      this.lap = 1
      this.lapTime = overshoot
      this.startLap()
      this.events.push({ type: 'start' })
      return
    }
    const complete = this.nextCheckpoint === 0
    if (!complete) {
      // crossed the line without all checkpoints (e.g. reversed over it and
      // came back): keep the current lap running, nothing is recorded.
      return
    }
    const time = this.lapTime - overshoot
    const valid = this.valid
    let isBest = false
    if (valid && (!this.best || time < this.best.time)) {
      const splits = this.splits.slice()
      splits[0] = time
      this.best = { time, splits, date: new Date().toISOString() }
      saveBest(this.best)
      isBest = true
    }
    this.lastLap = time
    this.lastLapValid = valid
    this.events.push({ type: 'lap', lapTime: time, valid, isBest })
    this.lap++
    this.lapTime = overshoot
    this.startLap()
  }

  private startLap() {
    this.valid = true
    this.invalidReason = ''
    this.nextCheckpoint = 1
    this.splits = []
    this.delta = null
    this.offTime = 0
  }
}

export function formatTime(t: number | null | undefined): string {
  if (t == null || !isFinite(t)) return '--:--.---'
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}
