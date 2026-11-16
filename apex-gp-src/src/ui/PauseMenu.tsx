import { game } from '../game/game'
import { Controls, Settings } from './Settings'

export function PauseMenu() {
  return (
    <div className="pause" role="dialog" aria-label="Paused">
      <div className="menu-panel">
        <div className="pause-title">PAUSED</div>
        <button className="btn primary" autoFocus onClick={() => game.togglePause()}>Resume</button>
        <button className="btn" onClick={() => game.startRace()}>Restart session</button>
        <button className="btn" onClick={() => game.quitToMenu()}>Quit to menu</button>
        <Settings />
        <Controls />
      </div>
    </div>
  )
}
