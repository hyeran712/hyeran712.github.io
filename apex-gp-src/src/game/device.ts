/** Device capability helpers (evaluated once at load). */
const mq = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches

/** Primary input is a touchscreen (phones, tablets). */
export const IS_TOUCH_DEVICE = mq('(pointer: coarse)') || (mq('(hover: none)') && (navigator.maxTouchPoints ?? 0) > 0)

/** Try to go fullscreen and lock landscape. Works on Android; silently ignored on iOS Safari. */
export function requestImmersive() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' })
    const lock = () => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape')?.catch(() => {})
    if (p) p.then(lock).catch(() => {})
  } catch { /* not supported */ }
}
