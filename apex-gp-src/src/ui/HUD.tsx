import { useEffect, useMemo, useRef, useState } from 'react'
import { game } from '../game/game'
import { QUALITY } from '../game/quality'
import { CAMERA_NAMES, useStore } from '../game/store'
import { formatTime } from '../game/timing/lapTimer'
import { track } from '../game/track/trackData'
import { CAR } from '../game/vehicle/vehiclePhysics'

const LEDS = 15

function useMiniMap() {
  return useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const c of track.samples) {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z)
    }
    const pad = 40
    const w = maxX - minX + pad * 2, h = maxZ - minZ + pad * 2
    // flip Z so the pit straight sits at the bottom of the map
    const px = (x: number) => x - minX + pad
    const pz = (z: number) => maxZ - z + pad
    let d = ''
    for (let i = 0; i < track.count; i += 3) d += `${i ? 'L' : 'M'}${px(track.samples[i].x).toFixed(0)} ${pz(track.samples[i].z).toFixed(0)}`
    return { d: d + 'Z', w, h, px, pz }
  }, [])
}

/**
 * Telemetry is written straight to the DOM every animation frame (no React
 * re-render), reading the live simulation state.
 */
export function HUD() {
  const camera = useStore(s => s.camera)
  const lights = useStore(s => s.lights)
  const phase = useStore(s => s.phase)
  const toast = useStore(s => s.toast)
  const quality = useStore(s => s.quality)
  const [shownToast, setShownToast] = useState(toast)
  const map = useMiniMap()
  const r = useRef<Record<string, HTMLElement | SVGElement | null>>({})
  const leds = useRef<(HTMLSpanElement | null)[]>([])
  const bind = (k: string) => (el: HTMLElement | SVGElement | null) => { r.current[k] = el }

  useEffect(() => {
    setShownToast(toast)
    if (!toast) return
    const id = setTimeout(() => setShownToast(null), 3200)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    let raf = 0
    let frames = 0, fpsT = performance.now()
    const text = (k: string, v: string) => { const el = r.current[k]; if (el && el.textContent !== v) el.textContent = v }
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (!game.ready) return
      const s = game.sim.state, t = game.timer
      text('speed', String(Math.round(Math.abs(s.speed) * 3.6)))
      text('gear', s.gear === -1 ? 'R' : s.speed < 0.3 && s.throttle < 0.05 && phase !== 'countdown' ? 'N' : String(s.gear))
      text('rpm', String(Math.round(s.rpm / 10) * 10))
      const rn = (s.rpm - 5200) / (CAR.redline - 5200 - 500)
      const lit = Math.round(Math.max(0, Math.min(1, rn)) * LEDS)
      const flash = s.rpm > CAR.redline - 450 && Math.floor(performance.now() / 60) % 2 === 0
      leds.current.forEach((el, i) => { if (el) el.className = i < lit ? (flash ? 'led on flash' : 'led on') : 'led' })
      ;(r.current.thr as HTMLElement).style.transform = `scaleY(${s.throttle})`
      ;(r.current.brk as HTMLElement).style.transform = `scaleY(${s.brake})`
      ;(r.current.steer as HTMLElement).style.transform = `translateX(${s.steerInput * 46}px)`

      text('lap', t.lap === 0 ? 'OUT' : String(t.lap).padStart(2, '0'))
      text('time', t.lap === 0 ? formatTime(0) : formatTime(t.lapTime))
      ;(r.current.time as HTMLElement).classList.toggle('invalid', !t.valid)
      text('last', formatTime(t.lastLap))
      ;(r.current.last as HTMLElement).classList.toggle('invalid', t.lastLap != null && !t.lastLapValid)
      text('best', formatTime(t.best?.time))
      const dEl = r.current.delta as HTMLElement
      if (t.delta != null && t.valid) {
        dEl.style.visibility = 'visible'
        text('delta', `${t.delta >= 0 ? '+' : '−'}${Math.abs(t.delta).toFixed(3)}`)
        dEl.className = `delta ${t.delta <= 0 ? 'good' : 'bad'}`
      } else dEl.style.visibility = 'hidden'

      const prog = s.loc.s / track.length
      text('prog', `${Math.floor(prog * 100)}%`)
      ;(r.current.progFill as HTMLElement).style.transform = `scaleX(${prog})`
      text('sector', `CP ${t.nextCheckpoint === 0 ? 10 : t.nextCheckpoint - 1}/10`)
      ;(r.current.dot as SVGElement).setAttribute('transform', `translate(${map.px(game.pose.x).toFixed(1)} ${map.pz(game.pose.z).toFixed(1)})`)

      // warnings
      const c = track.samples[s.loc.index]
      const heading = Math.cos(s.yaw) * c.tx + -Math.sin(s.yaw) * c.tz
      const wrong = heading < -0.35 && s.vx > 4
      const off = s.wheelsOff === 4 && s.speed > 3
      const w = r.current.warn as HTMLElement
      const msg = wrong ? 'WRONG WAY' : off ? 'OFF TRACK' : ''
      if (w.textContent !== msg) w.textContent = msg
      w.style.opacity = msg ? '1' : '0'

      frames++
      const now = performance.now()
      if (now - fpsT > 500) { text('fps', `${Math.round((frames * 1000) / (now - fpsT))} FPS`); frames = 0; fpsT = now }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [map, phase])

  return (
    <div className="hud">
      <div className="panel timing">
        <div className="timing-head"><span className="tag">LAP</span><b ref={bind('lap')}>OUT</b><span className="sector" ref={bind('sector')} /></div>
        <div className="time mono" ref={bind('time')}>0:00.000</div>
        <div className="delta" ref={bind('delta')} style={{ visibility: 'hidden' }} />
        <div className="timing-rows">
          <div><span>LAST</span><b className="mono" ref={bind('last')}>--:--.---</b></div>
          <div className="best"><span>BEST</span><b className="mono" ref={bind('best')}>--:--.---</b></div>
        </div>
      </div>

      <div className="panel mapbox">
        <svg viewBox={`0 0 ${map.w} ${map.h}`} className="minimap" aria-label="Track map">
          <path d={map.d} className="map-outline" />
          <path d={map.d} className="map-line" />
          <line x1={map.px(0)} x2={map.px(0)} y1={map.pz(0) - 26} y2={map.pz(0) + 26} className="map-sf" />
          <g ref={bind('dot')}><circle r="22" className="map-dot-halo" /><circle r="13" className="map-dot" /></g>
        </svg>
        <div className="prog"><div className="prog-fill" ref={bind('progFill')} /></div>
        <div className="map-row"><span>TRACK PROGRESS</span><b ref={bind('prog')}>0%</b></div>
        <div className="cam-row">
          {CAMERA_NAMES.map((n, i) => <span key={n} className={i === camera ? 'on' : ''}>{n}</span>)}
          <kbd>C</kbd>
        </div>
      </div>

      <div className="center-top">
        {phase === 'countdown' && (
          <div className="lights" aria-label="Start lights">
            {[0, 1, 2, 3, 4].map(i => <span key={i} className={i < lights ? 'on' : ''}><i /><i /></span>)}
          </div>
        )}
        {shownToast && phase !== 'countdown' && (
          <div key={shownToast.id} className={`toast ${shownToast.tone}`}>
            <b>{shownToast.text}</b>{shownToast.sub && <span className="mono">{shownToast.sub}</span>}
          </div>
        )}
        <div className="warn" ref={bind('warn')} />
      </div>

      <div className="cluster">
        <div className="leds">{Array.from({ length: LEDS }, (_, i) => (
          <span key={i} ref={el => { leds.current[i] = el }} className="led" data-zone={i < 5 ? 'g' : i < 10 ? 'r' : 'p'} />
        ))}</div>
        <div className="cluster-main">
          <div className="pedal brake"><div ref={bind('brk')} /></div>
          <div className="readout left"><b className="mono" ref={bind('speed')}>0</b><span>KM/H</span></div>
          <div className="gear" ref={bind('gear')}>N</div>
          <div className="readout right"><b className="mono" ref={bind('rpm')}>4000</b><span>RPM</span></div>
          <div className="pedal throttle"><div ref={bind('thr')} /></div>
        </div>
        <div className="steer"><div ref={bind('steer')} /></div>
      </div>

      <div className="corner-info"><span ref={bind('fps')}>-- FPS</span><span>{QUALITY[quality].label.toUpperCase()}</span><span>ESC · PAUSE</span><span>R · RESET</span></div>
    </div>
  )
}
