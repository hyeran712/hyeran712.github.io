/**
 * Simple pure-pursuit driver. Used by the headless simulation test and by the
 * `?autopilot` URL flag to verify that the circuit is drivable end to end.
 */
import { track } from '../track/trackData'
import type { VehicleInput, VehicleState } from './vehiclePhysics'

export function autopilot(s: VehicleState, out: VehicleInput): VehicleInput {
  const { samples, count } = track
  const look = Math.round((9 + s.speed * 0.32) / 2)
  const target = samples[(s.loc.index + look) % count]
  const fx = Math.cos(s.yaw), fz = -Math.sin(s.yaw)
  const dx = target.x - s.x, dz = target.z - s.z
  const ahead = dx * fx + dz * fz
  const side = dx * -fz + dz * fx
  const angle = Math.atan2(side, ahead)
  out.steer = Math.max(-1, Math.min(1, angle * 5))

  // target speed from the tightest curvature in the braking window
  let vTarget = 100
  const window = Math.round((20 + (s.speed * s.speed) / 38) / 2)
  for (let j = 0; j <= window; j++) {
    const k = Math.abs(samples[(s.loc.index + j) % count].k)
    if (k < 1e-4) continue
    const dist = j * 2
    // lateral limit ~ 1.5 g mechanical + aero; solve v^2 k = a(v) conservatively
    const vCorner = Math.sqrt((1.45 * 9.81) / Math.max(1e-4, k - 1.45 * 0.0028))
    const vc = isFinite(vCorner) && vCorner > 0 ? vCorner : 100
    // speed we may carry now and still brake to vc in `dist` at ~3 g
    const vAllowed = Math.sqrt(vc * vc + 2 * 28 * dist)
    vTarget = Math.min(vTarget, vAllowed)
  }
  const err = vTarget - s.speed
  out.throttle = err > 0 ? 1 : 0
  out.brake = err < -1.5 ? 1 : 0
  out.hardBrake = false
  return out
}
