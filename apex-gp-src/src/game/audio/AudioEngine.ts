/**
 * Fully procedural vehicle audio (Web Audio API) - no audio files.
 * Every voice is driven from the live VehicleState each frame.
 */
import { CAR, type VehicleState } from '../vehicle/vehiclePhysics'

function noiseBuffer(ctx: AudioContext, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

function distortion(amount: number) {
  const n = 1024, curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount)
  }
  return curve
}

export class AudioEngine {
  ctx: AudioContext | null = null
  private master!: GainNode
  private noise!: AudioBuffer
  private osc: OscillatorNode[] = []
  private oscMul = [1, 0.5, 2, 1.5, 0.25]
  private engineFilter!: BiquadFilterNode
  private engineGain!: GainNode
  private intakeGain!: GainNode
  private intakeFilter!: BiquadFilterNode
  private skidGain!: GainNode
  private skidFilter!: BiquadFilterNode
  private surfaceGain!: GainNode
  private surfaceFilter!: BiquadFilterNode
  private windGain!: GainNode
  private windFilter!: BiquadFilterNode
  private brakeGain!: GainNode
  private curbOsc!: OscillatorNode
  private curbGain!: GainNode
  private lastShift = 0
  private lastImpact = 0
  private volume = 0.8

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { void this.ctx.resume(); return }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = (this.ctx = new AC())
    this.noise = noiseBuffer(ctx)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2
    this.master = ctx.createGain()
    this.master.gain.value = this.volume
    this.master.connect(comp).connect(ctx.destination)

    // --- engine: stacked harmonics -> soft clip -> throttle-controlled low-pass
    const shaper = ctx.createWaveShaper()
    shaper.curve = distortion(2.6)
    shaper.oversample = '2x'
    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'; this.engineFilter.Q.value = 1.2
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0
    const types: OscillatorType[] = ['sawtooth', 'square', 'sawtooth', 'sawtooth', 'triangle']
    const levels = [0.5, 0.34, 0.16, 0.12, 0.3]
    types.forEach((type, i) => {
      const o = ctx.createOscillator(); o.type = type
      o.detune.value = [0, 7, -9, 5, 0][i]
      const g = ctx.createGain(); g.gain.value = levels[i]
      o.connect(g).connect(shaper); o.start()
      this.osc.push(o)
    })
    shaper.connect(this.engineFilter).connect(this.engineGain).connect(this.master)

    const loop = (filter: BiquadFilterNode, gain: GainNode, rate = 1) => {
      const src = ctx.createBufferSource()
      src.buffer = this.noise; src.loop = true; src.playbackRate.value = rate
      gain.gain.value = 0
      src.connect(filter).connect(gain).connect(this.master)
      src.start()
    }
    this.intakeFilter = ctx.createBiquadFilter(); this.intakeFilter.type = 'bandpass'; this.intakeFilter.Q.value = 1.4
    this.intakeGain = ctx.createGain(); loop(this.intakeFilter, this.intakeGain)
    this.skidFilter = ctx.createBiquadFilter(); this.skidFilter.type = 'bandpass'; this.skidFilter.Q.value = 5
    this.skidGain = ctx.createGain(); loop(this.skidFilter, this.skidGain, 0.9)
    this.surfaceFilter = ctx.createBiquadFilter(); this.surfaceFilter.type = 'lowpass'
    this.surfaceGain = ctx.createGain(); loop(this.surfaceFilter, this.surfaceGain, 0.6)
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'
    this.windGain = ctx.createGain(); loop(this.windFilter, this.windGain, 1.1)
    const brakeFilter = ctx.createBiquadFilter(); brakeFilter.type = 'bandpass'; brakeFilter.frequency.value = 3200; brakeFilter.Q.value = 0.8
    this.brakeGain = ctx.createGain(); loop(brakeFilter, this.brakeGain, 1.3)

    this.curbOsc = ctx.createOscillator(); this.curbOsc.type = 'square'
    const curbLp = ctx.createBiquadFilter(); curbLp.type = 'lowpass'; curbLp.frequency.value = 260
    this.curbGain = ctx.createGain(); this.curbGain.gain.value = 0
    this.curbOsc.connect(curbLp).connect(this.curbGain).connect(this.master)
    this.curbOsc.start()
  }

  setVolume(v: number) {
    this.volume = v
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  suspend() { void this.ctx?.suspend() }
  resume() { void this.ctx?.resume() }

  /** Fade the continuous voices out (menus). */
  silence() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    for (const g of [this.engineGain, this.intakeGain, this.skidGain, this.surfaceGain, this.windGain, this.brakeGain, this.curbGain]) {
      g.gain.setTargetAtTime(0, t, 0.08)
    }
  }

  private burst(freq: number, type: BiquadFilterType, gain: number, decay: number, q = 1) {
    const ctx = this.ctx!
    const src = ctx.createBufferSource(); src.buffer = this.noise
    src.loopStart = Math.random(); src.loop = true
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
    const g = ctx.createGain()
    const t = ctx.currentTime
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    src.connect(f).connect(g).connect(this.master)
    src.start(t, Math.random()); src.stop(t + decay + 0.05)
  }

  beep(freq: number, dur: number) {
    if (!this.ctx) return
    const ctx = this.ctx, t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.01)
    g.gain.setValueAtTime(0.22, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur)
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02)
  }

  update(s: VehicleState) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime
    const set = (p: AudioParam, v: number, tc = 0.03) => p.setTargetAtTime(v, t, tc)

    // V6: three firing pulses per crank revolution
    const f = (s.rpm / 60) * 3
    this.osc.forEach((o, i) => set(o.frequency, f * this.oscMul[i], 0.015))
    const rpmN = s.rpm / CAR.redline
    const load = s.throttle
    set(this.engineFilter.frequency, 500 + rpmN * 1700 + load * (1500 + rpmN * 4200), 0.04)
    let eg = 0.1 + rpmN * 0.1 + load * (0.2 + rpmN * 0.2)
    if (s.limiter) eg *= 0.6 + 0.4 * Math.sin(t * 90)
    set(this.engineGain.gain, eg, 0.03)
    set(this.intakeFilter.frequency, 900 + rpmN * 2600)
    set(this.intakeGain.gain, load * rpmN * 0.1, 0.05)

    // gear shifts: ignition-cut dip + mechanical clack (upshift) / overrun pop (downshift)
    if (s.shiftCount !== this.lastShift) {
      this.lastShift = s.shiftCount
      this.engineGain.gain.cancelScheduledValues(t)
      this.engineGain.gain.setValueAtTime(eg * 0.25, t)
      this.engineGain.gain.setTargetAtTime(eg, t + 0.05, 0.03)
      if (s.shiftUp) this.burst(1800, 'bandpass', 0.22, 0.07, 1.5)
      else { this.burst(260, 'lowpass', 0.4, 0.14); this.burst(2400, 'bandpass', 0.1, 0.05, 2) }
    }

    // tyres
    const speedN = Math.min(1, s.speed / 30)
    const onLoose = s.wheelsOff / 4
    const slide = Math.max(s.slipFront, s.slipRear, s.lockup, s.wheelspin * 0.8)
    set(this.skidFilter.frequency, 850 + slide * 500 + s.speed * 4)
    set(this.skidGain.gain, slide * speedN * 0.42 * (1 - onLoose), 0.04)
    // grass / gravel rumble
    set(this.surfaceFilter.frequency, 300 + s.speed * 14)
    set(this.surfaceGain.gain, onLoose * Math.min(1, s.speed / 25) * 0.55, 0.06)
    // kerb strike rhythm follows road speed over the painted blocks
    const onCurb = s.wheelSurface.some(w => w === 'curb')
    set(this.curbOsc.frequency, Math.max(18, s.speed / 2.2), 0.02)
    set(this.curbGain.gain, onCurb ? Math.min(0.3, 0.08 + s.speed * 0.004) : 0, 0.03)
    // brakes: disc hiss grows with pedal and speed
    set(this.brakeGain.gain, s.brake * Math.min(1, s.speed / 60) * 0.07, 0.05)
    // wind
    const w = Math.min(1, s.speed / 95)
    set(this.windFilter.frequency, 350 + w * 2400)
    set(this.windGain.gain, w * w * 0.3, 0.1)

    // collisions
    if (s.impactCount !== this.lastImpact) {
      this.lastImpact = s.impactCount
      const g = Math.min(1, s.impactStrength / 14)
      this.burst(900 + g * 900, 'lowpass', 0.35 + g * 0.6, 0.22 + g * 0.3)
      this.burst(3500, 'bandpass', 0.12 + g * 0.3, 0.12, 0.7)
      const o = ctx.createOscillator(); o.type = 'sine'
      o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25)
      const og = ctx.createGain(); og.gain.setValueAtTime(0.5 + g * 0.4, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.35)
    }
  }
}
