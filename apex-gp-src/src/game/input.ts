import type { VehicleInput } from './vehicle/vehiclePhysics'

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'KeyR', 'Escape',
])

/**
 * Analogue state written by the on-screen touch controls. It is merged with
 * the keyboard in Keyboard.read(), so both input methods always work.
 */
export const touchState = { throttle: 0, brake: 0, steer: 0 }

export function clearTouch() {
  touchState.throttle = touchState.brake = touchState.steer = 0
}

export class Keyboard {
  private down = new Set<string>()
  onCamera?: () => void
  onReset?: () => void
  onPause?: () => void

  private keydown = (e: KeyboardEvent) => {
    if (!GAME_KEYS.has(e.code)) return
    // let the browser keep its shortcuts (Ctrl+R etc.)
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) return
    e.preventDefault()
    if (!e.repeat) {
      if (e.code === 'KeyC') this.onCamera?.()
      else if (e.code === 'KeyR') this.onReset?.()
      else if (e.code === 'Escape') this.onPause?.()
    }
    this.down.add(e.code)
  }
  private keyup = (e: KeyboardEvent) => { this.down.delete(e.code) }
  private blur = () => { this.down.clear() }

  attach() {
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', this.keyup)
    window.addEventListener('blur', this.blur)
  }
  detach() {
    window.removeEventListener('keydown', this.keydown)
    window.removeEventListener('keyup', this.keyup)
    window.removeEventListener('blur', this.blur)
  }
  clear() { this.down.clear(); clearTouch() }

  read(out: VehicleInput): VehicleInput {
    const d = this.down
    out.throttle = Math.max(d.has('KeyW') || d.has('ArrowUp') ? 1 : 0, touchState.throttle)
    out.brake = Math.max(d.has('KeyS') || d.has('ArrowDown') ? 1 : 0, touchState.brake)
    const keySteer = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0)
    out.steer = keySteer !== 0 ? keySteer : touchState.steer
    out.hardBrake = d.has('Space')
    return out
  }
}
