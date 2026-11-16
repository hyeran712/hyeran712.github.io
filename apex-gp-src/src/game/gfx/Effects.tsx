import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { useFrame } from '@react-three/fiber'
import { ToneMappingMode } from 'postprocessing'
import { useMemo } from 'react'
import { game } from '../game'
import type { QualitySettings } from '../quality'
import { useStore } from '../store'
import { SpeedBlurEffect } from './SpeedBlurEffect'

/** Post-processing chain. Everything is deliberately subtle. */
export function Effects({ q }: { q: QualitySettings }) {
  const blur = useMemo(() => new SpeedBlurEffect(), [])
  useFrame(() => {
    if (!game.ready) return
    const racing = useStore.getState().phase === 'racing'
    const n = Math.max(0, (game.sim.state.speed - 35) / 60)
    blur.strength = racing ? Math.min(1, n) * 0.05 : 0
  })
  return (
    <EffectComposer multisampling={q.msaa} enableNormalPass={false}>
      {q.ao ? <N8AO aoRadius={1.6} intensity={1.6} distanceFalloff={0.6} halfRes={q.aoHalfRes} quality={q.aoHalfRes ? 'medium' : 'high'} /> : <></>}
      {q.bloom ? <Bloom mipmapBlur intensity={0.32} luminanceThreshold={1.0} luminanceSmoothing={0.25} radius={0.7} /> : <></>}
      {q.motionBlur ? <primitive object={blur} /> : <></>}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.32} darkness={0.42} />
      {q.msaa === 0 ? <SMAA /> : <></>}
    </EffectComposer>
  )
}
