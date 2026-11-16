import { useStore } from '../game/store'

export function LoadingScreen() {
  const progress = useStore(s => s.loadProgress)
  const label = useStore(s => s.loadLabel)
  return (
    <div className="loading">
      <div className="loading-inner">
        <div className="brand"><span className="brand-mark" />APEX<b>GP</b></div>
        <div className="loading-sub">TIME TRIAL · CIRCUITO COSTA VERDE</div>
        <div className="loading-bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="loading-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="loading-row"><span>{label}</span><span>{Math.round(progress * 100)}%</span></div>
      </div>
    </div>
  )
}
