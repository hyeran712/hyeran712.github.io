import { useState } from 'react'
import { IS_TOUCH_DEVICE, requestImmersive } from '../game/device'
import { game } from '../game/game'
import { useStore } from '../game/store'
import { formatTime } from '../game/timing/lapTimer'
import { track } from '../game/track/trackData'
import { Controls, Settings } from './Settings'

export function MainMenu() {
  const placeholder = useStore(s => s.placeholderCar)
  const [best, setBest] = useState(game.timer.best)
  return (
    <div className="menu">
      <div className="menu-panel">
        <div className="brand"><span className="brand-mark" />APEX<b>GP</b></div>
        <div className="menu-sub">TIME TRIAL</div>
        <div className="menu-track">
          <div><span>Circuit</span><b>Circuito Costa Verde</b></div>
          <div><span>Length</span><b>{(track.length / 1000).toFixed(3)} km</b></div>
          <div><span>Personal best</span><b className="mono">{formatTime(best?.time)}</b></div>
        </div>
        <button className="btn primary" autoFocus onClick={() => { if (IS_TOUCH_DEVICE) requestImmersive(); game.startRace() }}>Start session</button>
        <Settings />
        <Controls />
        <div className="menu-foot">
          {best && <button className="link" onClick={() => { game.clearBestLap(); setBest(null) }}>Clear saved best lap</button>}
          {placeholder && <span>Car model: built-in procedural stand-in (see ASSETS.md to use a GLB).</span>}
        </div>
      </div>
    </div>
  )
}
