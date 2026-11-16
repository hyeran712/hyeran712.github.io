/**
 * Game session singleton: owns the simulation, lap timer, input and audio and
 * advances them once per rendered frame. React components only *read* from it.
 */
import RAPIER from '@dimforge/rapier3d-compat'
import { AudioEngine } from './audio/AudioEngine'
import { Keyboard } from './input'
import { useStore } from './store'
import { LapTimer, formatTime, clearBest } from './timing/lapTimer'
import { autopilot } from './vehicle/autopilot'
import { CAR, VehicleSim, type VehicleInput } from './vehicle/vehiclePhysics'

const LIGHT_INTERVAL = 0.85

class Game {
  sim!: VehicleSim
  timer = new LapTimer()
  keys = new Keyboard()
  audio = new AudioEngine()
  input: VehicleInput = { throttle: 0, brake: 0, steer: 0, hardBrake: false }
  ready = false
  /** interpolated render pose */
  pose = { x: 0, z: 0, yaw: 0 }
  /** decaying 0..1 kick for camera shake after impacts */
  impactShake = 0
  autopilot = typeof location !== 'undefined' && new URLSearchParams(location.search).has('autopilot')
  private countdownT = 0
  private goAt = 0
  private lastImpact = 0
  private initPromise: Promise<void> | null = null

  init(): Promise<void> {
    this.initPromise ??= (async () => {
      await RAPIER.init()
      this.sim = new VehicleSim()
      this.timer.reset(this.sim.state.loc.s)
      this.syncPose(1)
      this.keys.onCamera = () => this.cycleCamera()
      this.keys.onReset = () => this.resetCar()
      this.keys.onPause = () => this.togglePause()
      this.keys.attach()
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && ['racing', 'countdown'].includes(useStore.getState().phase)) this.togglePause()
      })
      this.ready = true
    })()
    return this.initPromise
  }

  /** (Re)start the session from the grid with a fresh countdown. */
  startRace() {
    const st = useStore.getState()
    this.audio.start()
    this.audio.setVolume(st.volume)
    this.audio.resume()
    this.sim.placeOnGrid()
    this.timer.reset(this.sim.state.loc.s)
    this.syncPose(1)
    this.keys.clear()
    this.countdownT = 0
    this.goAt = LIGHT_INTERVAL * 5 + 0.7 + Math.random() * 1.1
    this.impactShake = 0
    this.lastImpact = this.sim.state.impactCount
    st.set({ phase: 'countdown', lights: 0, toast: null })
  }

  cycleCamera() {
    const st = useStore.getState()
    if (st.phase === 'racing' || st.phase === 'countdown') st.set({ camera: (st.camera + 1) % 3 })
  }

  resetCar() {
    if (useStore.getState().phase !== 'racing') return
    this.sim.resetToTrack()
    this.timer.invalidate('CAR RESET')
    this.syncPose(1)
  }

  togglePause() {
    const st = useStore.getState()
    if (st.phase === 'racing' || st.phase === 'countdown') {
      this.keys.clear()
      st.set({ phase: 'paused', resumePhase: st.phase })
      this.audio.suspend()
    } else if (st.phase === 'paused') {
      this.keys.clear()
      st.set({ phase: st.resumePhase })
      this.audio.resume()
    }
  }

  quitToMenu() {
    this.audio.resume()
    this.audio.silence()
    this.sim.placeOnGrid()
    this.timer.reset(this.sim.state.loc.s)
    this.syncPose(1)
    useStore.getState().set({ phase: 'menu', lights: 0, toast: null })
  }

  clearBestLap() {
    clearBest()
    this.timer.best = null
    this.timer.delta = null
  }

  /** Called once per frame from the render loop. */
  tick(dt: number) {
    if (!this.ready) return
    const st = useStore.getState()
    const s = this.sim.state

    if (st.phase === 'countdown') {
      this.countdownT += dt
      const lit = Math.min(5, Math.floor(this.countdownT / LIGHT_INTERVAL))
      if (this.countdownT >= this.goAt) {
        st.set({ phase: 'racing', lights: 0 })
        this.audio.beep(1040, 0.5)
      } else if (lit !== st.lights) {
        st.set({ lights: lit })
        this.audio.beep(520, 0.16)
      }
      // car is held on the grid, but the engine can be revved
      this.keys.read(this.input)
      const target = CAR.idle + this.input.throttle * 6500
      s.rpm += (target - s.rpm) * Math.min(1, dt * (this.input.throttle ? 7 : 4))
      s.throttle = this.input.throttle
      this.audio.update(s)
      return
    }

    if (st.phase !== 'racing') return

    this.keys.read(this.input)
    const alpha = this.sim.update(dt, this.input, step => {
      if (this.autopilot) autopilot(s, this.input)
      this.timer.update(step, s.loc.s, s.wheelsOff, s.vx)
    })
    this.syncPose(alpha)

    let e
    while ((e = this.timer.poll())) {
      if (e.type === 'lap') {
        if (e.isBest) st.showToast({ text: 'NEW BEST LAP', sub: formatTime(e.lapTime), tone: 'best' })
        else if (e.valid) st.showToast({ text: 'LAP COMPLETE', sub: formatTime(e.lapTime), tone: 'good' })
        else st.showToast({ text: 'LAP NOT COUNTED', sub: formatTime(e.lapTime), tone: 'bad' })
        this.audio.beep(e.isBest ? 1320 : 880, 0.18)
      } else if (e.type === 'invalidated') {
        st.showToast({ text: 'LAP INVALIDATED', sub: e.reason, tone: 'bad' })
      } else if (e.type === 'start') {
        st.showToast({ text: 'LAP 1', sub: 'TIMING STARTED', tone: 'info' })
      }
    }

    if (s.impactCount !== this.lastImpact) {
      this.lastImpact = s.impactCount
      this.impactShake = Math.min(1, this.impactShake + s.impactStrength / 12)
    }
    this.impactShake *= Math.exp(-dt * 5)
    this.audio.update(s)
  }

  private syncPose(alpha: number) {
    const s = this.sim.state, p = this.sim.prev
    this.pose.x = p.x + (s.x - p.x) * alpha
    this.pose.z = p.z + (s.z - p.z) * alpha
    let dy = s.yaw - p.yaw
    if (dy > Math.PI) dy -= Math.PI * 2
    else if (dy < -Math.PI) dy += Math.PI * 2
    this.pose.yaw = p.yaw + dy * alpha
  }
}

export const game = new Game()
if (typeof window !== 'undefined') (window as unknown as { __game: Game }).__game = game
