import { useEffect, useRef } from 'react'
import { game } from '../game/game'
import { clearTouch, touchState } from '../game/input'
import { CAMERA_NAMES, useStore } from '../game/store'

type PE = React.PointerEvent<HTMLElement>

/**
 * A press-and-hold control. Each element captures its own pointer, so any
 * number of controls can be held at the same time (steer + throttle + brake).
 */
function useHold(set: (v: number) => void) {
  const id = useRef<number | null>(null)
  const down = (e: PE) => {
    e.preventDefault()
    if (id.current !== null) return
    id.current = e.pointerId
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    e.currentTarget.classList.add('on')
    set(1)
  }
  const up = (e: PE) => {
    if (e.pointerId !== id.current) return
    id.current = null
    e.currentTarget.classList.remove('on')
    set(0)
  }
  return { onPointerDown: down, onPointerUp: up, onPointerCancel: up, onLostPointerCapture: up }
}

/** One-shot button that fires on touch-down (reliable while other fingers are held). */
function tap(fn: () => void) {
  return {
    onPointerDown: (e: PE) => { e.preventDefault(); e.stopPropagation(); fn() },
  }
}

export function TouchControls() {
  const camera = useStore(s => s.camera)
  const pad = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const steerId = useRef<number | null>(null)

  const gas = useHold(v => { touchState.throttle = v })
  const brake = useHold(v => { touchState.brake = v })

  useEffect(() => () => clearTouch(), [])

  const steerFrom = (e: PE) => {
    const el = pad.current!
    const r = el.getBoundingClientRect()
    // the outer 12% on each side is already full lock, so it is easy to reach
    let v = ((e.clientX - r.left) / r.width - 0.5) / 0.38
    v = Math.max(-1, Math.min(1, v))
    // finer control around the centre
    const shaped = Math.sign(v) * Math.abs(v) ** 1.35
    touchState.steer = Math.abs(shaped) < 0.04 ? 0 : shaped
    if (thumb.current) thumb.current.style.transform = `translateX(${v * (r.width * 0.38)}px)`
  }
  const steerDown = (e: PE) => {
    e.preventDefault()
    if (steerId.current !== null) return
    steerId.current = e.pointerId
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    e.currentTarget.classList.add('on')
    steerFrom(e)
  }
  const steerMove = (e: PE) => { if (e.pointerId === steerId.current) steerFrom(e) }
  const steerUp = (e: PE) => {
    if (e.pointerId !== steerId.current) return
    steerId.current = null
    touchState.steer = 0
    e.currentTarget.classList.remove('on')
    if (thumb.current) thumb.current.style.transform = 'translateX(0px)'
  }

  return (
    <div className="touch-ui" onContextMenu={e => e.preventDefault()}>
      <div className="t-top">
        <button className="t-btn" aria-label="Pause" {...tap(() => game.togglePause())}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
        </button>
        <button className="t-btn wide" aria-label={`Change camera, current ${CAMERA_NAMES[camera]}`} {...tap(() => game.cycleCamera())}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.4" className="cut" /></svg>
          <span>{CAMERA_NAMES[camera]}</span>
        </button>
        <button className="t-btn" aria-label="Reset car to track" {...tap(() => game.resetCar())}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="stroke"><path d="M5 12a7 7 0 1 0 2.2-5.1" /><path d="M4 4v4.5h4.5" /></svg>
        </button>
      </div>

      <div
        className="t-steer" ref={pad} role="slider" aria-label="Steering" aria-valuemin={-1} aria-valuemax={1} aria-valuenow={0}
        onPointerDown={steerDown} onPointerMove={steerMove} onPointerUp={steerUp} onPointerCancel={steerUp} onLostPointerCapture={steerUp}
      >
        <svg viewBox="0 0 24 24" className="arrow" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        <div className="t-track"><div className="t-thumb" ref={thumb} /></div>
        <svg viewBox="0 0 24 24" className="arrow" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </div>

      <div className="t-pedals">
        <button className="t-pedal brake" aria-label="Brake" {...brake}><span>BRAKE</span></button>
        <button className="t-pedal gas" aria-label="Accelerate" {...gas}><span>GAS</span></button>
      </div>
    </div>
  )
}

/** Shown on phones held upright: the game is landscape-only. Pauses the session. */
export function RotateHint() {
  const phase = useStore(s => s.phase)
  useEffect(() => {
    if (phase === 'racing' || phase === 'countdown') game.togglePause()
  }, [phase])
  return (
    <div className="rotate" role="alert">
      <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="22" y="8" width="20" height="36" rx="3" /><path d="M10 48a22 22 0 0 0 22 10" /><path d="M32 52l-1 6 6 1" /></svg>
      <b>Rotate your phone</b>
      <span>APEX GP plays in landscape.</span>
    </div>
  )
}
