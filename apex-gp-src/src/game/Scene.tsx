import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping, BackSide, BufferAttribute, Color, DirectionalLight, Fog, SphereGeometry, Mesh, MeshBasicMaterial, NoToneMapping,
  PlaneGeometry, SRGBColorSpace, ShaderMaterial,
} from 'three'
import { CameraRig } from './camera/CameraRig'
import { game } from './game'
import { Effects } from './gfx/Effects'
import { loadEnvironment, type EnvAsset } from './gfx/environment'
import { makeBlob, makeClouds } from './gfx/textures'
import { IS_TOUCH_DEVICE } from './device'
import { resolveQuality, type QualitySettings } from './quality'
import { useStore } from './store'
import { buildTrackScene, type TrackScene } from './track/trackScene'
import { loadCarVisual } from './vehicle/carLoader'
import type { CarVisual } from './vehicle/proceduralCar'

interface Assets { track: TrackScene; car: CarVisual; env: EnvAsset }

const DEBUG_ENV = new URLSearchParams(location.search).has('debugenv')

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)))

/** Loads everything in visible steps so the loading screen can report progress. */
async function loadAssets(q: QualitySettings): Promise<Assets> {
  const set = useStore.getState().set
  set({ loadProgress: 0.05, loadLabel: 'Starting physics' })
  await game.init()
  set({ loadProgress: 0.2, loadLabel: 'Loading HDR lighting' })
  const env = await loadEnvironment(f => set({ loadProgress: 0.2 + f * 0.25 }))
  set({ loadProgress: 0.45, loadLabel: 'Building circuit' })
  await nextFrame()
  const track = buildTrackScene({ anisotropy: q.anisotropy, detail: q.detail })
  set({ loadProgress: 0.8, loadLabel: 'Preparing car' })
  await nextFrame()
  const car = await loadCarVisual()
  set({ loadProgress: 0.95, loadLabel: 'Compiling shaders', placeholderCar: car.placeholder })
  await nextFrame()
  return { track, car, env }
}

function GameLoop() {
  useFrame((_, dt) => game.tick(dt), -3)
  return null
}

function World({ assets, q }: { assets: Assets; q: QualitySettings }) {
  const lights = useStore(s => s.lights)
  useEffect(() => assets.track.setStartLights(lights), [lights, assets])
  useEffect(() => assets.track.applyQuality(q.anisotropy, q.detail), [q, assets])
  return <primitive object={assets.track.group} />
}

function Car({ assets }: { assets: Assets }) {
  const camera = useStore(s => s.camera)
  const phase = useStore(s => s.phase)
  const blob = useMemo(() => {
    const m = new Mesh(new PlaneGeometry(6.6, 3), new MeshBasicMaterial({
      map: makeBlob(), transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }))
    m.rotation.x = -Math.PI / 2
    m.position.set(0, 0.012, 0)
    m.renderOrder = 2
    return m
  }, [])
  useEffect(() => {
    assets.car.root.add(blob)
    return () => { assets.car.root.remove(blob) }
  }, [assets, blob])
  useEffect(() => {
    assets.car.setCockpitView(camera === 1 && phase !== 'menu')
  }, [camera, phase, assets])
  useFrame((_, dt) => {
    const root = assets.car.root
    root.position.set(game.pose.x, 0, game.pose.z)
    root.rotation.y = game.pose.yaw
    if (useStore.getState().phase !== 'paused') assets.car.update(game.sim.state, Math.min(dt, 0.05))
  }, -2)
  return <primitive object={assets.car.root} />
}

/** Sun + image-based lighting + sky + atmosphere. The shadow frustum follows the car. */
function Lighting({ env, q }: { env: EnvAsset; q: QualitySettings }) {
  const scene = useThree(s => s.scene)
  const gl = useThree(s => s.gl)
  const light = useRef<DirectionalLight>(null)
  const sky = useMemo(() => {
    // analytic clear-sky gradient with a sun glow; authored in scene-linear
    // values that sit comfortably under ACES tone mapping
    const m = new Mesh(new SphereGeometry(8600, 32, 16), new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false,
      uniforms: { sun: { value: env.sun.clone() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sun;
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 zenith = vec3(0.075, 0.24, 0.66), mid = vec3(0.24, 0.47, 0.86), horizon = vec3(0.66, 0.79, 0.93);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h));
          c = mix(c, zenith, smoothstep(0.15, 0.85, h));
          float s = max(dot(d, sun), 0.0);
          c += vec3(1.0, 0.86, 0.66) * (pow(s, 6.0) * 0.22 + pow(s, 60.0) * 0.5);
          c += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9998, s) * 30.0;
          c = mix(c, vec3(0.5, 0.56, 0.5), smoothstep(0.0, -0.06, d.y));
          gl_FragColor = vec4(c * 1.15, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }))
    m.renderOrder = -2
    m.frustumCulled = false
    return m
  }, [env])
  const clouds = useMemo(() => {
    // dome that follows the camera; UVs are a planar projection so the layer
    // recedes towards the horizon, where it fades out
    const g = new SphereGeometry(8200, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.49)
    const p = g.attributes.position, uv = g.attributes.uv
    const col = new Float32Array(p.count * 4)
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 8200
      const k = 1 / (y + 0.12)
      uv.setXY(i, (p.getX(i) / 8200) * k * 0.55, (p.getZ(i) / 8200) * k * 0.55)
      col.set([1, 1, 1, Math.max(0, Math.min(1, (y - 0.035) / 0.16))], i * 4)
    }
    g.setAttribute('color', new BufferAttribute(col, 4))
    const m = new Mesh(g, new MeshBasicMaterial({
      map: makeClouds(), transparent: true, depthWrite: false, fog: false, side: BackSide, vertexColors: true, opacity: 0.92,
    }))
    m.renderOrder = -1
    m.frustumCulled = false
    return m
  }, [])

  useEffect(() => {
    scene.environment = env.texture
    scene.environmentIntensity = 0.85
    scene.environmentRotation.set(0, env.rotationY, 0)
    if (DEBUG_ENV) { scene.background = env.texture; scene.backgroundRotation.set(0, env.rotationY, 0) }
    scene.fog = new Fog(new Color('#b9cde4'), 450, 4300)
    return () => { scene.environment = null; scene.fog = null }
  }, [scene, env])

  useEffect(() => {
    gl.toneMapping = q.post ? NoToneMapping : ACESFilmicToneMapping
    gl.toneMappingExposure = 1
    gl.outputColorSpace = SRGBColorSpace
    scene.traverse(o => { const m = (o as Mesh).material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { x.needsUpdate = true }) })
  }, [gl, q.shadows, q.post, scene])

  useFrame(({ camera }) => {
    clouds.position.set(camera.position.x, -60, camera.position.z)
    sky.position.copy(camera.position)
    const l = light.current
    if (!l) return
    const { x, z } = game.pose
    l.position.set(x + env.sun.x * 160, env.sun.y * 160, z + env.sun.z * 160)
    l.target.position.set(x, 0, z)
    l.target.updateMatrixWorld()
  })

  return (
    <>
      {!DEBUG_ENV && <primitive object={sky} />}
      {q.clouds && !DEBUG_ENV && <primitive object={clouds} />}
      <directionalLight
        key={q.shadowMapSize}
        ref={light}
        color="#fff3e2"
        intensity={3.1}
        castShadow={q.shadows}
        shadow-mapSize={[q.shadowMapSize, q.shadowMapSize]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.04}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={1}
        shadow-camera-far={420}
      />
      <hemisphereLight args={['#cfe2ff', '#59663f', 0.25]} />
    </>
  )
}

/** Compile all shaders up front so the first lap does not hitch. */
function Warmup({ onReady }: { onReady: () => void }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try { await gl.compileAsync(scene, camera) } catch { gl.compile(scene, camera) }
      if (!cancelled) onReady()
    }
    void run()
    return () => { cancelled = true }
  }, [gl, scene, camera, onReady])
  return null
}

export function Scene() {
  const quality = useStore(s => s.quality)
  const adaptive = useStore(s => s.adaptive)
  const resScale = useStore(s => s.resScale)
  const q = useMemo(() => resolveQuality(quality, IS_TOUCH_DEVICE), [quality])
  const [assets, setAssets] = useState<Assets | null>(null)

  useEffect(() => {
    let alive = true
    loadAssets(resolveQuality(useStore.getState().quality, IS_TOUCH_DEVICE)).then(a => { if (alive) setAssets(a) })
      .catch(err => {
        console.error(err)
        useStore.getState().set({ loadLabel: 'Failed to load: ' + (err?.message ?? err) })
      })
    return () => { alive = false }
  }, [])

  const device = Math.min(window.devicePixelRatio || 1, 2)
  const maxDpr = Math.min(q.dpr[1], Math.max(device, 1))
  const minDpr = Math.min(q.dpr[0], maxDpr)
  const dpr = adaptive ? minDpr + (maxDpr - minDpr) * resScale : maxDpr

  const ready = useMemo(() => () => {
    const st = useStore.getState()
    if (st.phase === 'loading') st.set({ phase: 'menu', loadProgress: 1, loadLabel: 'Ready' })
  }, [])

  return (
    <Canvas
      className="game-canvas"
      dpr={dpr}
      // R3F re-applies this prop on every render, so shadows must be driven from here
      shadows={q.shadows ? 'soft' : false}
      gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 60, near: 0.12, far: 9000, position: [-40, 3, 8] }}
      onCreated={({ gl, scene }) => { (window as unknown as { __three: unknown }).__three = { gl, scene } }}
    >
      {assets && (
        <>
          <PerformanceMonitor
            ms={300}
            iterations={6}
            onChange={({ factor }) => { if (useStore.getState().adaptive) useStore.getState().set({ resScale: Math.round(factor * 4) / 4 }) }}
          />
          <GameLoop />
          <Lighting env={assets.env} q={q} />
          <World assets={assets} q={q} />
          <Car assets={assets} />
          <CameraRig />
          {q.post && <Effects q={q} />}
          <Warmup onReady={ready} />
        </>
      )}
    </Canvas>
  )
}
