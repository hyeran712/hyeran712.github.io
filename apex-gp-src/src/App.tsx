import { Scene } from './game/Scene'
import { useStore } from './game/store'
import { HUD } from './ui/HUD'
import { LoadingScreen } from './ui/LoadingScreen'
import { MainMenu } from './ui/MainMenu'
import { PauseMenu } from './ui/PauseMenu'

export function App() {
  const phase = useStore(s => s.phase)
  return (
    <div className="app">
      <Scene />
      {(phase === 'racing' || phase === 'countdown' || phase === 'paused') && <HUD />}
      {phase === 'menu' && <MainMenu />}
      {phase === 'paused' && <PauseMenu />}
      {phase === 'loading' && <LoadingScreen />}
    </div>
  )
}
