import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { game } from '../game'
import { useStore } from '../store'

const UP = new Vector3(0, 1, 0)
const tPos = new Vector3(), tLook = new Vector3(), tmp = new Vector3()
const tQuat = new Quaternion()
const lookHelper = new PerspectiveCamera()

/** frame-rate independent smoothing factor */
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)

function angleLerp(a: number, b: number, t: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * Three driving cameras (chase / cockpit / nose) plus a slow orbit for menus.
 * Mode changes blend position, orientation and FOV over ~0.7 s.
 */
export function CameraRig() {
  const camera = useThree(s => s.camera) as PerspectiveCamera
  const mode = useStore(s => s.camera)
  const st = useRef({
    camYaw: 0, last: new Vector3(), init: false, time: 0,
    fromPos: new Vector3(), fromQuat: new Quaternion(), fromFov: 60, blend: 1, lastMode: 0, orbit: 0, wasMenu: true,
    dist: 6.4,
  })

  useEffect(() => {
    const s = st.current
    s.fromPos.copy(camera.position); s.fromQuat.copy(camera.quaternion); s.fromFov = camera.fov
    s.blend = 0
  }, [mode, camera])

  useFrame((_, rawDt) => {
    if (!game.ready) return
    const dt = Math.min(rawDt, 0.1)
    const s = st.current
    const phase = useStore.getState().phase
    const v = game.sim.state
    const { x, z, yaw } = game.pose
    const fx = Math.cos(yaw), fz = -Math.sin(yaw)
    const rx = -fz, rz = fx
    const paused = phase === 'paused'
    if (!paused) s.time += dt

    // snap follow state after teleports
    if (!s.init || s.last.distanceToSquared(tmp.set(x, 0, z)) > 400) { s.camYaw = yaw; s.init = true }
    s.last.set(x, 0, z)

    const menu = phase === 'menu' || phase === 'loading'
    if (menu !== s.wasMenu) {
      s.wasMenu = menu
      s.fromPos.copy(camera.position); s.fromQuat.copy(camera.quaternion); s.fromFov = camera.fov
      s.blend = 0
    }

    let fov = 60
    const speedN = Math.min(1, v.speed / 92)
    // restrained shake: speed buzz, rough surfaces, impacts
    const rough = (v.wheelsOff / 4) * Math.min(1, v.speed / 18) + (v.wheelSurface.some(w => w === 'curb') ? 0.35 * Math.min(1, v.speed / 30) : 0)
    const shake = speedN * speedN * 0.011 + rough * 0.03 + game.impactShake * 0.14
    const t = s.time
    const nx = Math.sin(t * 47.3) * 0.6 + Math.sin(t * 91.7 + 1.3) * 0.4
    const ny = Math.sin(t * 53.9 + 2.1) * 0.6 + Math.sin(t * 103.3) * 0.4

    if (menu) {
      if (!paused) s.orbit += dt * 0.16
      const a = yaw + 2.2 + s.orbit
      tPos.set(x + Math.cos(a) * 7.4, 1.25 + Math.sin(s.orbit * 0.7) * 0.35, z - Math.sin(a) * 7.4)
      // frame the car in the right-hand part of the screen, clear of the menu
      const ox = -Math.sin(a) * 2.3, oz = -Math.cos(a) * 2.3
      tLook.set(x + ox, 0.62, z + oz)
      fov = 40
    } else if (mode === 0) {
      if (!paused) s.camYaw = angleLerp(s.camYaw, yaw, damp(5.2, dt))
      const cx = Math.cos(s.camYaw), cz = -Math.sin(s.camYaw)
      const wantDist = 6.3 + speedN * 1.0 + MathUtils.clamp(v.gLong, -5, 2) * 0.13
      if (!paused) s.dist += (wantDist - s.dist) * damp(4, dt)
      const side = MathUtils.clamp(-v.gLat * 0.05, -0.3, 0.3)
      tPos.set(x - cx * s.dist + rx * side, 2.25 - speedN * 0.2, z - cz * s.dist + rz * side)
      tPos.x += rx * nx * shake * 0.5; tPos.y += ny * shake * 0.5; tPos.z += rz * nx * shake * 0.5
      tLook.set(x + fx * 5, 0.1, z + fz * 5)
      fov = 56 + speedN * 15
    } else {
      const local = mode === 1 ? [0.04, 0.82, 0] : [2.3, 0.54, 0]
      const lookYaw = mode === 1 ? -v.steerInput * 0.07 : 0
      tPos.set(x + fx * local[0] + rx * nx * shake, local[1] + ny * shake, z + fz * local[0] + rz * nx * shake)
      const lx = Math.cos(yaw + lookYaw), lz = -Math.sin(yaw + lookYaw)
      tLook.set(tPos.x + lx * 10, tPos.y - (mode === 1 ? 0.35 : 0.9), tPos.z + lz * 10)
      fov = (mode === 1 ? 74 : 70) + speedN * 10
    }

    // debugging aid: window.__cam = { pos: [x,y,z] (car-relative), look: [x,y,z], fov }
    const dbg = (window as unknown as { __cam?: { pos: number[]; look: number[]; fov?: number } }).__cam
    if (dbg) {
      tPos.set(x + fx * dbg.pos[0] + rx * dbg.pos[2], dbg.pos[1], z + fz * dbg.pos[0] + rz * dbg.pos[2])
      tLook.set(x + fx * dbg.look[0] + rx * dbg.look[2], dbg.look[1], z + fz * dbg.look[0] + rz * dbg.look[2])
      fov = dbg.fov ?? 45
    }

    lookHelper.position.copy(tPos)
    lookHelper.up.copy(UP)
    lookHelper.lookAt(tLook)
    tQuat.copy(lookHelper.quaternion)

    if (s.blend < 1) {
      s.blend = Math.min(1, s.blend + rawDt / 0.7)
      const e = s.blend * s.blend * (3 - 2 * s.blend)
      camera.position.lerpVectors(s.fromPos, tPos, e)
      camera.quaternion.slerpQuaternions(s.fromQuat, tQuat, e)
      camera.fov = MathUtils.lerp(s.fromFov, fov, e)
    } else {
      camera.position.copy(tPos)
      camera.quaternion.copy(tQuat)
      camera.fov = fov
    }
    camera.updateProjectionMatrix()
  }, -1)

  return null
}
