import type { VehicleInput } from './vehicle/vehiclePhysics'

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'KeyR', 'Escape',
])

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
  clear() { this.down.clear() }

  read(out: VehicleInput): VehicleInput {
    const d = this.down
    out.throttle = d.has('KeyW') || d.has('ArrowUp') ? 1 : 0
    out.brake = d.has('KeyS') || d.has('ArrowDown') ? 1 : 0
    out.steer = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0)
    out.hardBrake = d.has('Space')
    return out
  }
}
