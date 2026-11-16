import { game } from '../game/game'
import { IS_TOUCH_DEVICE } from '../game/device'
import { QUALITY, QUALITY_ORDER, resolveQuality } from '../game/quality'
import { useStore } from '../game/store'

/** Graphics preset, adaptive resolution and volume. Shared by both menus. */
export function Settings() {
  const quality = useStore(s => s.quality)
  const adaptive = useStore(s => s.adaptive)
  const volume = useStore(s => s.volume)
  const setSetting = useStore(s => s.setSetting)
  const q = resolveQuality(quality, IS_TOUCH_DEVICE)
  return (
    <div className="settings">
      <div className="field">
        <label>Graphics</label>
        <div className="segmented" role="radiogroup" aria-label="Graphics quality">
          {QUALITY_ORDER.map(name => (
            <button key={name} role="radio" aria-checked={quality === name} className={quality === name ? 'on' : ''}
              onClick={() => setSetting({ quality: name })}>{QUALITY[name].label}</button>
          ))}
        </div>
        <div className="hint">
          {q.shadows ? `${q.shadowMapSize}px shadows` : 'No shadows'} · {q.post ? [q.ao && 'AO', q.bloom && 'bloom', q.motionBlur && 'speed blur'].filter(Boolean).join(', ') || 'tone mapping' : 'no post-processing'} · up to {q.dpr[1]}× resolution
        </div>
      </div>
      <div className="field row">
        <label htmlFor="adaptive">Adaptive resolution</label>
        <button id="adaptive" className={`toggle ${adaptive ? 'on' : ''}`} role="switch" aria-checked={adaptive}
          onClick={() => setSetting({ adaptive: !adaptive })}><span /></button>
      </div>
      <div className="field row">
        <label htmlFor="volume">Volume</label>
        <input id="volume" type="range" min={0} max={1} step={0.05} value={volume}
          onChange={e => { const v = Number(e.target.value); setSetting({ volume: v }); game.audio.setVolume(v) }} />
      </div>
    </div>
  )
}

export function Controls() {
  const touch = useStore(s => s.touch)
  const rows: [string, string][] = touch ? [
    ['Left pad', 'Slide left / right to steer'], ['Right pedals', 'Brake (left) · accelerator (right)'],
    ['Brake held', 'Reverses once stopped'], ['Top buttons', 'Pause · camera · reset to track'],
  ] : [
    ['W / ↑', 'Accelerate'], ['S / ↓', 'Brake · reverse when stopped'], ['A D / ← →', 'Steer'],
    ['Space', 'Hard braking'], ['C', 'Change camera'], ['R', 'Reset to track'], ['Esc', 'Pause'],
  ]
  return (
    <dl className="controls">
      {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
    </dl>
  )
}
