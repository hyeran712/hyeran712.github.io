/**
 * Custom simcade vehicle controller.
 *
 * The chassis is a Rapier dynamic rigid body constrained to the ground plane
 * (the circuit is flat), so Rapier does integration and barrier collision
 * response. Tyre, aero and drivetrain forces come from the single-track
 * ("bicycle") model below and are applied to the body each fixed step.
 *
 * Car frame: +X forward, +Z right. yawRight > 0 means turning right.
 */
import RAPIER from '@dimforge/rapier3d-compat'
import {
  locate, poseAt, surfaceAt, track, type Surface, type TrackLocation,
} from '../track/trackData'

export const FIXED_DT = 1 / 120

export const CAR = {
  mass: 800,
  inertia: 1250,
  wheelbase: 3.6,
  cgToFront: 1.72,
  cgToRear: 1.88,
  cgHeight: 0.3,
  trackWidth: 1.62,
  wheelRadius: 0.36,
  halfLength: 2.7,
  halfWidth: 0.98,
  // aero
  dragArea: 1.25, // Cd * A
  liftArea: 3.7, // Cl * A (downforce)
  aeroFront: 0.42,
  // drivetrain
  power: 745_000, // W
  maxDriveForce: 13_500,
  redline: 12_500,
  idle: 4_000,
  /** speed (m/s) reached at the redline in each gear */
  gearTop: [27, 37, 47, 57, 67, 77, 87, 97],
  // tyres
  tyreB: 13,
  tyreC: 1.5,
  maxSteer: 0.4,
}

const G = 9.81
const RHO = 1.2

const SURFACE_GRIP: Record<Surface, number> = { asphalt: 1.8, curb: 1.5, grass: 0.72, gravel: 0.58 }
/** rolling drag as a fraction of weight, plus a speed-proportional term */
const SURFACE_DRAG: Record<Surface, [number, number]> = {
  asphalt: [0.012, 0],
  curb: [0.02, 0],
  grass: [0.11, 14],
  gravel: [0.3, 46],
}

export interface VehicleInput {
  throttle: number // 0..1 (W)
  brake: number // 0..1 (S)
  steer: number // -1..1, right positive
  hardBrake: boolean // Space
}

export interface VehicleState {
  x: number
  z: number
  yaw: number
  /** forward speed m/s (negative in reverse) */
  vx: number
  /** lateral speed m/s (right positive) */
  vy: number
  yawRight: number
  speed: number
  gear: number // -1 = R, 1..8
  rpm: number
  throttle: number
  brake: number
  /** front wheel angle in radians, right positive */
  steerAngle: number
  /** smoothed -1..1 steering input */
  steerInput: number
  /** accumulated wheel rotation, radians */
  wheelRot: number
  /** 0..1 lateral sliding intensity (front, rear) */
  slipFront: number
  slipRear: number
  /** 0..1 wheelspin / lock-up intensity */
  wheelspin: number
  lockup: number
  /** longitudinal / lateral acceleration in g */
  gLong: number
  gLat: number
  wheelSurface: Surface[] // FL, FR, RL, RR
  wheelsOff: number
  loc: TrackLocation
  /** increments on each gear change */
  shiftCount: number
  shiftUp: boolean
  /** increments on each impact; strength is the velocity change in m/s */
  impactCount: number
  impactStrength: number
  limiter: boolean
}

function powerCurve(x: number) {
  // normalised power vs normalised rpm, peaking near 0.88
  if (x < 0.3) return 0.3 + x
  if (x < 0.88) return 0.6 + 0.4 * ((x - 0.3) / 0.58) ** 0.8
  return 1 - 0.9 * (x - 0.88)
}

function magic(alpha: number, B: number, C: number) {
  return Math.sin(C * Math.atan(B * alpha))
}

const WHEEL_LOCAL: [number, number][] = [
  [CAR.cgToFront, -CAR.trackWidth / 2],
  [CAR.cgToFront, CAR.trackWidth / 2],
  [-CAR.cgToRear, -CAR.trackWidth / 2],
  [-CAR.cgToRear, CAR.trackWidth / 2],
]

export class VehicleSim {
  world: RAPIER.World
  body: RAPIER.RigidBody
  state: VehicleState
  /** previous fixed-step pose, for render interpolation */
  prev = { x: 0, z: 0, yaw: 0 }
  private accumulator = 0
  private shiftTimer = 0
  private shiftCooldown = 0
  private axSmoothed = 0
  private tmpLoc: TrackLocation = { index: 0, d: 0, s: 0 }
  private smThrottle = 0
  private smBrake = 0

  /** RAPIER.init() must have resolved before constructing. */
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    this.world.timestep = FIXED_DT

    // --- barriers -----------------------------------------------------------
    const walls = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    const { samples, count } = track
    const step = 3
    const thick = 0.6
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i += step) {
        const a = samples[i]
        const b = samples[(i + step) % count]
        const da = (side < 0 ? a.wallL : a.wallR) + thick
        const db = (side < 0 ? b.wallL : b.wallR) + thick
        const ax = a.x + -a.tz * side * da
        const az = a.z + a.tx * side * da
        const bx = b.x + -b.tz * side * db
        const bz = b.z + b.tx * side * db
        const len = Math.hypot(bx - ax, bz - az)
        const yaw = Math.atan2(-(bz - az), bx - ax)
        const desc = RAPIER.ColliderDesc.cuboid(len / 2 + 0.35, 1, thick)
          .setTranslation((ax + bx) / 2, 1, (az + bz) / 2)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
          .setFriction(0.25)
          .setRestitution(0.12)
        this.world.createCollider(desc, walls)
      }
    }

    // --- chassis ------------------------------------------------------------
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .enabledTranslations(true, false, true)
      .enabledRotations(false, true, false)
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAdditionalMassProperties(
        CAR.mass,
        { x: 0, y: 0, z: 0 },
        { x: CAR.inertia, y: CAR.inertia, z: CAR.inertia },
        { x: 0, y: 0, z: 0, w: 1 },
      )
    this.body = this.world.createRigidBody(bodyDesc)
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(CAR.halfLength, 0.5, CAR.halfWidth)
        .setTranslation(0.15, 0.5, 0)
        .setDensity(0)
        .setFriction(0.25)
        .setRestitution(0.12),
      this.body,
    )

    this.state = {
      x: 0, z: 0, yaw: 0, vx: 0, vy: 0, yawRight: 0, speed: 0,
      gear: 1, rpm: CAR.idle, throttle: 0, brake: 0,
      steerAngle: 0, steerInput: 0, wheelRot: 0,
      slipFront: 0, slipRear: 0, wheelspin: 0, lockup: 0, gLong: 0, gLat: 0,
      wheelSurface: ['asphalt', 'asphalt', 'asphalt', 'asphalt'], wheelsOff: 0,
      loc: { index: 0, d: 0, s: 0 },
      shiftCount: 0, shiftUp: true, impactCount: 0, impactStrength: 0, limiter: false,
    }
    this.placeOnGrid()
  }

  /** Grid slot a little before the start/finish line. */
  placeOnGrid() {
    const idx = track.count - Math.round(36 / 2)
    this.teleport(idx, 0)
  }

  /** Put the car back on the racing surface near where it is now. */
  resetToTrack() {
    const loc = locate(this.state.x, this.state.z, -1)
    this.teleport(loc.index, 0)
  }

  teleport(index: number, lateral: number) {
    const p = poseAt(index, lateral)
    this.body.setTranslation({ x: p.x, y: 0, z: p.z }, true)
    this.body.setRotation({ x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.body.resetForces(true)
    this.body.resetTorques(true)
    const s = this.state
    s.x = p.x; s.z = p.z; s.yaw = p.yaw
    s.vx = s.vy = s.yawRight = s.speed = 0
    s.gear = 1; s.rpm = CAR.idle; s.steerInput = 0; s.steerAngle = 0
    s.slipFront = s.slipRear = s.wheelspin = s.lockup = 0
    s.gLong = s.gLat = 0
    this.axSmoothed = 0
    this.smThrottle = this.smBrake = 0
    this.accumulator = 0
    this.prev.x = p.x; this.prev.z = p.z; this.prev.yaw = p.yaw
    locate(p.x, p.z, -1, s.loc)
  }

  /**
   * Advance by a variable frame delta using fixed sub-steps.
   * Returns the interpolation factor for rendering between prev and current.
   */
  update(frameDt: number, input: VehicleInput, onStep?: (dt: number) => void): number {
    this.accumulator += Math.min(frameDt, 0.1)
    let n = 0
    while (this.accumulator >= FIXED_DT && n < 16) {
      this.step(input)
      onStep?.(FIXED_DT)
      this.accumulator -= FIXED_DT
      n++
    }
    if (n === 16) this.accumulator = 0
    return this.accumulator / FIXED_DT
  }

  step(input: VehicleInput) {
    const dt = FIXED_DT
    const s = this.state
    const body = this.body

    this.prev.x = s.x; this.prev.z = s.z; this.prev.yaw = s.yaw

    // --- body state -> car frame -------------------------------------------
    const lin = body.linvel()
    const fx = Math.cos(s.yaw), fz = -Math.sin(s.yaw) // forward
    const rx = -fz, rz = fx // right
    const vx = lin.x * fx + lin.z * fz
    const vy = lin.x * rx + lin.z * rz
    const r = -body.angvel().y
    const speed = Math.hypot(vx, vy)
    const absVx = Math.abs(vx)

    // --- input shaping ------------------------------------------------------
    const steerRate = (input.steer === 0 ? 5.5 : 3.6) / (1 + speed * 0.012)
    const ds = input.steer - s.steerInput
    s.steerInput += Math.sign(ds) * Math.min(Math.abs(ds), steerRate * dt)

    // pedal intent, including S = reverse at low speed
    let throttleIn = input.throttle
    let brakeIn = Math.max(input.brake * 0.86, input.hardBrake ? 1 : 0)
    let reverse = false
    if (input.brake > 0 && input.throttle === 0 && !input.hardBrake && vx < 1.2) {
      reverse = true
      throttleIn = input.brake
      brakeIn = 0
    } else if (vx < -1 && input.throttle > 0) {
      // rolling backwards with W held: brake first
      brakeIn = Math.max(brakeIn, input.throttle)
      throttleIn = 0
    }
    this.smThrottle += Math.max(-dt * 9, Math.min(dt * 5, throttleIn - this.smThrottle))
    this.smBrake += Math.max(-dt * 10, Math.min(dt * 7, brakeIn - this.smBrake))
    const throttle = this.smThrottle
    const brake = this.smBrake

    // --- surfaces -----------------------------------------------------------
    let grip = [0, 0] // front, rear axle
    let dragC = 0, dragV = 0, off = 0
    for (let w = 0; w < 4; w++) {
      const [lx, lz] = WHEEL_LOCAL[w]
      const wx = s.x + fx * lx + rx * lz
      const wz = s.z + fz * lx + rz * lz
      const loc = locate(wx, wz, s.loc.index, this.tmpLoc)
      const surf = surfaceAt(loc)
      s.wheelSurface[w] = surf
      if (surf === 'grass' || surf === 'gravel') off++
      grip[w < 2 ? 0 : 1] += SURFACE_GRIP[surf] * 0.5
      dragC += SURFACE_DRAG[surf][0] * 0.25
      dragV += SURFACE_DRAG[surf][1] * 0.25
    }
    s.wheelsOff = off

    // --- loads --------------------------------------------------------------
    const v2 = speed * speed
    const downforce = 0.5 * RHO * CAR.liftArea * v2
    const transfer = (CAR.mass * this.axSmoothed * CAR.cgHeight) / CAR.wheelbase
    const weight = CAR.mass * G
    const fzF = Math.max(300, (weight * CAR.cgToRear) / CAR.wheelbase + downforce * CAR.aeroFront - transfer)
    const fzR = Math.max(300, (weight * CAR.cgToFront) / CAR.wheelbase + downforce * (1 - CAR.aeroFront) + transfer)
    const capF = grip[0] * fzF
    const capR = grip[1] * fzR * 1.06

    // --- steering -----------------------------------------------------------
    // Limit lock to what the tyres can use at this speed (+ a little beyond the peak).
    const latAccMax = grip[0] * (G + downforce / CAR.mass)
    const peakSlip = Math.tan(Math.PI / (2 * CAR.tyreC)) / CAR.tyreB
    const usable = (CAR.wheelbase * latAccMax) / Math.max(v2, 1) + peakSlip * 1.15
    const lock = Math.min(CAR.maxSteer, usable)
    const delta = s.steerInput * lock
    s.steerAngle = delta
    const cd = Math.cos(delta), sd = Math.sin(delta)

    // --- lateral tyre forces ------------------------------------------------
    const vmin = 6
    const vfy = vy + CAR.cgToFront * r
    const vry = vy - CAR.cgToRear * r
    const fLat = vfy * cd - vx * sd
    const fLong = vx * cd + vfy * sd
    const alphaF = Math.atan2(fLat, Math.max(Math.abs(fLong), vmin))
    const alphaR = Math.atan2(vry, Math.max(absVx, vmin))
    let FyF = -capF * magic(alphaF, CAR.tyreB, CAR.tyreC)
    let FyR = -capR * magic(alphaR, CAR.tyreB * 1.08, CAR.tyreC)

    // --- drivetrain ---------------------------------------------------------
    this.shiftCooldown -= dt
    this.shiftTimer -= dt
    let gear = s.gear
    if (reverse) {
      gear = -1
    } else {
      if (gear < 1) gear = 1
      if (this.shiftCooldown <= 0) {
        const top = CAR.gearTop[gear - 1]
        if (gear < 8 && vx > top * 0.955 && throttle > 0.2) {
          gear++; this.shift(true)
        } else if (gear > 1 && vx < CAR.gearTop[gear - 2] * 0.8) {
          gear--; this.shift(false)
        }
      }
    }
    s.gear = gear

    let drive = 0
    let rpmTarget: number
    s.limiter = false
    if (gear === -1) {
      const lim = 12
      drive = -throttle * 5200 * Math.max(0, 1 - Math.max(0, -vx) / lim)
      rpmTarget = CAR.idle + (Math.max(0, -vx) / lim) * 5000 + throttle * 1500
    } else {
      const top = CAR.gearTop[gear - 1]
      let x = Math.max(0, vx) / top
      // clutch slip for launches in first gear
      if (gear === 1) x = Math.max(x, (CAR.idle + throttle * 4800) / CAR.redline)
      x = Math.max(x, CAR.idle / CAR.redline)
      if (x >= 1) { s.limiter = true }
      rpmTarget = Math.min(1.0, x) * CAR.redline
      const p = CAR.power * powerCurve(Math.min(x, 1))
      drive = throttle * Math.min(CAR.maxDriveForce, p / Math.max(vx, 9))
      if (s.limiter) drive *= 0.05
      if (this.shiftTimer > 0) drive *= 0.1
      // engine braking off-throttle
      if (throttle < 0.05 && vx > 2) drive -= 500 + 1500 * x
    }
    s.rpm += (rpmTarget - s.rpm) * Math.min(1, dt * 18)

    // --- brakes -------------------------------------------------------------
    const dir = vx >= 0 ? 1 : -1
    const brakeDemand = brake * (capF + capR) * 1.02
    const moving = absVx > 0.4
    let FxF = moving ? -dir * brakeDemand * 0.6 : 0
    let FxR = drive + (moving ? -dir * brakeDemand * 0.4 : 0)

    // --- friction circle with mild TC / ABS ---------------------------------
    // Longitudinal force gets what the lateral demand leaves (plus a little
    // extra so the car can still be provoked), then lateral force is trimmed.
    const assist = input.hardBrake ? 1.22 : 1.08
    const combine = (Fx: number, Fy: number, cap: number, over: number) => {
      const usedLat = Math.min(1, Math.abs(Fy) / cap)
      const avail = cap * Math.max(0.3, Math.sqrt(1 - usedLat * usedLat)) * over
      let excess = 0
      if (Math.abs(Fx) > avail) {
        excess = Math.abs(Fx) / avail - 1
        Fx = Math.sign(Fx) * avail
      }
      const usedLong = Math.min(1, Math.abs(Fx) / cap)
      const latScale = Math.sqrt(Math.max(0.08, 1 - usedLong * usedLong))
      const fyLimit = cap * latScale
      if (Math.abs(Fy) > fyLimit) Fy = Math.sign(Fy) * fyLimit
      return [Fx, Fy, excess] as const
    }
    const front = combine(FxF, FyF, capF, assist)
    const rear = combine(FxR, FyR, capR, drive > 0 && brake < 0.05 ? 1.1 : assist)
    FxF = front[0]; FyF = front[1]
    FxR = rear[0]; FyR = rear[1]

    const spinNow = drive > 0 && brake < 0.05 ? Math.min(1, rear[2] * 0.8) : 0
    const lockNow = brake > 0.3 && moving ? Math.min(1, Math.max(front[2], rear[2]) * (input.hardBrake ? 2.2 : 0.6)) : 0
    s.wheelspin += (spinNow * Math.min(1, speed / 4 + throttle) - s.wheelspin) * Math.min(1, dt * 10)
    s.lockup += (lockNow * Math.min(1, speed / 12) - s.lockup) * Math.min(1, dt * 10)

    // --- resistances --------------------------------------------------------
    const aeroDrag = 0.5 * RHO * CAR.dragArea * v2
    let resist = 0
    if (speed > 0.05) resist = aeroDrag + dragC * (weight + downforce * 0.2) + dragV * speed
    const rvx = speed > 0.05 ? (-vx / speed) * resist : 0
    const rvy = speed > 0.05 ? (-vy / speed) * resist : 0

    // --- sum in car frame ---------------------------------------------------
    let Fx = FxR + FxF * cd - FyF * sd + rvx
    let Fy = FyR + FyF * cd + FxF * sd + rvy
    let Mz = CAR.cgToFront * (FyF * cd + FxF * sd) - CAR.cgToRear * FyR

    // hold still when parked
    const parked = speed < 0.35 && Math.abs(drive) < 50 && Math.abs(r) < 0.2
    if (parked) {
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      Fx = Fy = Mz = 0
    }

    body.resetForces(true)
    body.resetTorques(true)
    body.addForce({ x: fx * Fx + rx * Fy, y: 0, z: fz * Fx + rz * Fy }, true)
    body.addTorque({ x: 0, y: -Mz, z: 0 }, true)

    // expected velocity (no contacts), to detect impacts afterwards
    const evx = lin.x + ((fx * Fx + rx * Fy) / CAR.mass) * dt
    const evz = lin.z + ((fz * Fx + rz * Fy) / CAR.mass) * dt

    this.world.step()

    // --- read back ----------------------------------------------------------
    const t = body.translation()
    const q = body.rotation()
    const nl = body.linvel()
    s.x = t.x; s.z = t.z
    s.yaw = 2 * Math.atan2(q.y, q.w)
    const nfx = Math.cos(s.yaw), nfz = -Math.sin(s.yaw)
    s.vx = nl.x * nfx + nl.z * nfz
    s.vy = nl.x * -nfz + nl.z * nfx
    s.yawRight = -body.angvel().y
    s.speed = Math.hypot(nl.x, nl.z)
    s.throttle = reverse ? 0 : throttle
    s.brake = brake
    s.wheelRot += (s.vx / CAR.wheelRadius) * dt * (1 + s.wheelspin * 1.5) * (1 - s.lockup * 0.9)

    const impact = Math.hypot(nl.x - evx, nl.z - evz)
    if (impact > 0.6) {
      s.impactCount++
      s.impactStrength = impact
      // scrub some spin so wall hits don't turn into pirouettes
      const av = body.angvel()
      body.setAngvel({ x: 0, y: av.y * 0.7, z: 0 }, true)
    }

    const ax = Fx / CAR.mass
    this.axSmoothed += (ax - this.axSmoothed) * Math.min(1, dt * 12)
    s.gLong += (ax / G - s.gLong) * Math.min(1, dt * 8)
    s.gLat += (Fy / CAR.mass / G - s.gLat) * Math.min(1, dt * 8)

    // skid intensity: how far past the slip peak each axle is
    const sf = Math.max(0, Math.abs(alphaF) / peakSlip - 0.85) * Math.min(1, speed / 8)
    const sr = Math.max(0, Math.abs(alphaR) / peakSlip - 0.85) * Math.min(1, speed / 8)
    s.slipFront += (Math.min(1, sf) - s.slipFront) * Math.min(1, dt * 12)
    s.slipRear += (Math.min(1, sr) - s.slipRear) * Math.min(1, dt * 12)

    locate(s.x, s.z, s.loc.index, s.loc)
  }

  private shift(up: boolean) {
    this.shiftTimer = up ? 0.07 : 0.03
    this.shiftCooldown = 0.22
    this.state.shiftCount++
    this.state.shiftUp = up
  }

  dispose() {
    this.world.free()
  }
}
