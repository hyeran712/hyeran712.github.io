/**
 * Headless verification of the driving model and lap logic (no browser).
 *   npm run test:sim
 */
import RAPIER from '@dimforge/rapier3d-compat'
import { VehicleSim, FIXED_DT, type VehicleInput } from '../src/game/vehicle/vehiclePhysics'
import { autopilot } from '../src/game/vehicle/autopilot'
import { LapTimer, formatTime } from '../src/game/timing/lapTimer'
import { track } from '../src/game/track/trackData'

let failed = 0
const check = (name: string, ok: boolean, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`)
  if (!ok) failed++
}

await RAPIER.init()
const input: VehicleInput = { throttle: 0, brake: 0, steer: 0, hardBrake: false }

// 1. straight-line acceleration and braking
{
  const sim = new VehicleSim()
  sim.teleport(track.count - 200, 0) // 400 m before the line: ~900 m of straight ahead
  input.throttle = 1
  let t = 0, t100 = 0, t200 = 0
  while (t < 9) {
    sim.step(input); t += FIXED_DT
    if (!t100 && sim.state.speed * 3.6 >= 100) t100 = t
    if (!t200 && sim.state.speed * 3.6 >= 200) t200 = t
  }
  const v = sim.state.speed * 3.6
  check('0-100 km/h in 2-3.5 s', t100 > 2 && t100 < 3.5, `${t100.toFixed(2)} s`)
  check('0-200 km/h in 4-6.5 s', t200 > 4 && t200 < 6.5, `${t200.toFixed(2)} s`)
  check('speed after 9 s is 250-330 km/h', v > 250 && v < 330, `${v.toFixed(0)} km/h, gear ${sim.state.gear}`)
  check('stays straight without steering', Math.abs(sim.state.loc.d) < 0.2, `offset ${sim.state.loc.d.toFixed(3)} m`)
  input.throttle = 0; input.brake = 1
  const x0 = sim.state.loc.s; let tb = 0
  const v0 = sim.state.speed
  while (sim.state.speed > 0.5 && tb < 10) { sim.step(input); tb += FIXED_DT }
  let dist = sim.state.loc.s - x0; if (dist < 0) dist += track.length
  check('brakes to a stop in under 4.5 s', tb < 4.5, `${(v0 * 3.6).toFixed(0)}→0 in ${tb.toFixed(2)} s, ${dist.toFixed(0)} m`)
  // hold S: reverse
  for (let i = 0; i < 240; i++) sim.step(input)
  check('S at standstill reverses', sim.state.vx < -3 && sim.state.gear === -1, `vx ${sim.state.vx.toFixed(1)} m/s`)
  input.brake = 0
}

// 2. top speed
{
  const sim = new VehicleSim()
  // hypothetical: measure on the straight only
  sim.teleport(track.count - 230, 0)
  input.throttle = 1; input.steer = 0
  let vmax = 0
  for (let i = 0; i < 120 * 11; i++) { sim.step(input); vmax = Math.max(vmax, sim.state.speed) }
  check('reaches 290+ km/h on the main straight', vmax * 3.6 > 290, `${(vmax * 3.6).toFixed(0)} km/h`)
}

// 3. barrier collision: drive straight on at the hairpin
{
  const sim = new VehicleSim()
  sim.teleport(200, 0)
  input.throttle = 1; input.steer = 0; input.brake = 0
  let maxOut = 0
  for (let i = 0; i < 120 * 14; i++) {
    sim.step(input)
    const c = track.samples[sim.state.loc.index]
    maxOut = Math.max(maxOut, Math.abs(sim.state.loc.d) - Math.max(c.wallL, c.wallR))
  }
  check('barriers contain the car', maxOut < 1.5 && sim.state.impactCount > 0, `impacts ${sim.state.impactCount}, max beyond wall ${maxOut.toFixed(2)} m`)
  check('pose stays finite after crash', isFinite(sim.state.x) && isFinite(sim.state.yaw))
  sim.resetToTrack()
  check('reset returns car to the track', Math.abs(sim.state.loc.d) < 0.5 && sim.state.speed === 0)
}

// 4. full laps on autopilot with lap timing
{
  const sim = new VehicleSim()
  const timer = new LapTimer()
  timer.best = null
  sim.placeOnGrid()
  timer.reset(sim.state.loc.s)
  const laps: { t: number; valid: boolean }[] = []
  let t = 0, maxLat = 0, vmax = 0, vmin = 999, offs = 0
  while (t < 240 && laps.length < 2) {
    autopilot(sim.state, input)
    sim.step(input)
    timer.update(FIXED_DT, sim.state.loc.s, sim.state.wheelsOff, sim.state.vx)
    let e
    while ((e = timer.poll())) if (e.type === 'lap') laps.push({ t: e.lapTime!, valid: e.valid! })
    t += FIXED_DT
    if (timer.lap >= 1) {
      maxLat = Math.max(maxLat, Math.abs(sim.state.gLat)); vmax = Math.max(vmax, sim.state.speed)
      if (timer.lap === 2) vmin = Math.min(vmin, sim.state.speed)
      if (sim.state.wheelsOff === 4) offs++
    }
  }
  check('autopilot completes 2 laps', laps.length === 2, laps.map(l => `${formatTime(l.t)}${l.valid ? '' : ' (invalid)'}`).join(', '))
  check('laps are valid (checkpoints in order, on track)', laps.every(l => l.valid), `off-track steps ${offs}`)
  check('no wall contact on a clean lap', sim.state.impactCount === 0, `impacts ${sim.state.impactCount}`)
  console.log(`      peak lateral ${maxLat.toFixed(2)} g, vmax ${(vmax * 3.6).toFixed(0)} km/h, slowest corner ${(vmin * 3.6).toFixed(0)} km/h`)

  // 5. frame-rate independence: same inputs at 30 fps and 144 fps frame deltas
  const run = (fps: number) => {
    const s2 = new VehicleSim(); s2.placeOnGrid()
    const inp: VehicleInput = { throttle: 0, brake: 0, steer: 0, hardBrake: false }
    let tt = 0
    while (tt < 20 - 1e-9) { s2.update(1 / fps, inp, () => { autopilot(s2.state, inp) }); tt += 1 / fps }
    return s2.state.loc.s
  }
  const a = run(30), b = run(144)
  check('frame-rate independent (30 vs 144 fps)', Math.abs(a - b) < 12, `s after 20 s: ${a.toFixed(1)} vs ${b.toFixed(1)} m`)
}

// 6. lap validity rules
{
  const timer = new LapTimer(); timer.best = null
  const L = track.length
  const drive = (from: number, to: number, stepM: number, off = 0) => {
    const n = Math.ceil(Math.abs(to - from) / Math.abs(stepM))
    for (let i = 1; i <= n; i++) {
      const s = (((from + (to - from) * (i / n)) % L) + L) % L
      timer.update(0.01, s, off, Math.sign(stepM))
    }
  }
  const evs = () => { const r = []; let e; while ((e = timer.poll())) r.push(e); return r }
  // reversing over the line then driving forward again must not create a lap
  timer.reset(L - 30); drive(L - 30, L + 20, 0.5); evs()
  drive(L + 20, L - 20, -0.5); drive(L - 20, L + 30, 0.5)
  check('reversing across the line records nothing', !evs().some(e => e.type === 'lap') && timer.lap === 1)
  // skipping checkpoints (teleport-style shortcut) must not count
  timer.reset(L - 30); drive(L - 30, L + 50, 0.5); evs()
  timer.update(0.01, L * 0.9, 0, 1); drive(L * 0.9, L + 20, 0.5)
  check('skipping checkpoints records nothing', !evs().some(e => e.type === 'lap'))
  // a clean lap counts; an off-track lap completes but is invalid
  timer.reset(L - 30); drive(L - 30, 2 * L + 10, 0.5)
  const clean = evs().find(e => e.type === 'lap')
  check('clean lap is recorded as best', !!clean?.valid && !!clean?.isBest)
  drive(10, L * 0.5, 0.5); drive(L * 0.5, L * 0.52, 0.5, 4); drive(L * 0.52, L + 10, 0.5)
  const dirty = evs().find(e => e.type === 'lap')
  check('track-limits lap is completed but invalid', !!dirty && dirty.valid === false && dirty.isBest === false)
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
process.exit(failed ? 1 : 0)
