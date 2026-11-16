import { useEffect, useState } from 'react'
import { Scene } from './game/Scene'
import { useStore } from './game/store'
import { HUD } from './ui/HUD'
import { LoadingScreen } from './ui/LoadingScreen'
import { MainMenu } from './ui/MainMenu'
import { PauseMenu } from './ui/PauseMenu'
import { RotateHint, TouchControls } from './ui/TouchControls'

/** Keeps a CSS scale factor in sync with the viewport so the HUD fits any screen. */
function useViewport() {
  const [portrait, setPortrait] = useState(false)
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth, h = window.innerHeight
      const ui = Math.max(0.5, Math.min(1, h / 640, w / 1180))
      document.documentElement.style.setProperty('--ui', ui.toFixed(3))
      setPortrait(h > w * 1.05)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    // first touch on a hybrid device switches the on-screen controls on
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && !useStore.getState().touch) useStore.getState().set({ touch: true })
    }
    window.addEventListener('pointerdown', onPointer)
    // iOS Safari: block pinch-zoom of the page while playing
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', stop)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
      window.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('gesturestart', stop)
    }
  }, [])
  return portrait
}

export function App() {
  const phase = useStore(s => s.phase)
  const touch = useStore(s => s.touch)
  const portrait = useViewport()
  const inSession = phase === 'racing' || phase === 'countdown' || phase === 'paused'
  return (
    <div className={`app${touch ? ' touch' : ''}`}>
      <Scene />
      {inSession && <HUD />}
      {touch && (phase === 'racing' || phase === 'countdown') && <TouchControls />}
      {phase === 'menu' && <MainMenu />}
      {phase === 'paused' && <PauseMenu />}
      {phase === 'loading' && <LoadingScreen />}
      {touch && portrait && phase !== 'loading' && <RotateHint />}
    </div>
  )
}
