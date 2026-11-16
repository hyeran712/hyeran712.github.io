/** UI-facing state. Per-frame telemetry is read straight from `game` instead. */
import { create } from 'zustand'
import { IS_TOUCH_DEVICE } from './device'
import type { QualityName } from './quality'

export type Phase = 'loading' | 'menu' | 'countdown' | 'racing' | 'paused'
export const CAMERA_NAMES = ['CHASE', 'COCKPIT', 'NOSE'] as const

export interface Toast { id: number; text: string; sub?: string; tone: 'good' | 'bad' | 'info' | 'best' }

interface Settings { quality: QualityName; volume: number; adaptive: boolean }
const SETTINGS_KEY = 'apex-gp:settings:v1'

function loadSettings(): Settings {
  // phones start on the lightest preset; it can be raised in the menu
  const def: Settings = { quality: IS_TOUCH_DEVICE ? 'low' : 'high', volume: 0.8, adaptive: true }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...def, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return def
}

interface Store extends Settings {
  phase: Phase
  /** phase to return to when unpausing */
  resumePhase: Phase
  camera: number
  /** start lights lit, 0-5 */
  lights: number
  toast: Toast | null
  loadProgress: number
  loadLabel: string
  placeholderCar: boolean
  /** show on-screen touch controls (touch device, or a touch was seen) */
  touch: boolean
  /** current adaptive resolution scale 0..1 within the preset's DPR range */
  resScale: number
  set: (p: Partial<Store>) => void
  setSetting: (p: Partial<Settings>) => void
  showToast: (t: Omit<Toast, 'id'>) => void
}

let toastId = 0
export const useStore = create<Store>((set, get) => ({
  ...loadSettings(),
  phase: 'loading',
  resumePhase: 'racing',
  camera: 0,
  lights: 0,
  toast: null,
  loadProgress: 0,
  loadLabel: 'Starting',
  placeholderCar: true,
  touch: IS_TOUCH_DEVICE,
  resScale: 1,
  set: p => set(p),
  setSetting: p => {
    set(p)
    const { quality, volume, adaptive } = get()
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ quality, volume, adaptive })) } catch { /* ignore */ }
  },
  showToast: t => set({ toast: { ...t, id: ++toastId } }),
}))
