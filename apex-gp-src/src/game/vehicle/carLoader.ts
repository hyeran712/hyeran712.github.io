/**
 * Car visual loader.
 *
 * If `public/models/formula_car.glb` exists it is used; otherwise the built-in
 * procedural stand-in is returned. See ASSETS.md for the GLB conventions.
 */
import { Box3, Group, Mesh, Object3D, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { buildProceduralCar, type CarVisual } from './proceduralCar'
import { CAR } from './vehiclePhysics'

export const CAR_GLB_URL = 'models/formula_car.glb'

async function glbAvailable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    const type = res.headers.get('content-type') ?? ''
    // dev servers answer unknown paths with index.html
    return res.ok && !type.includes('text/html')
  } catch { return false }
}

function wrapGlb(scene: Group): CarVisual {
  const root = new Group()
  // normalise: length 5.6 m along +X, sitting on the ground, centred on the wheelbase
  const box = new Box3().setFromObject(scene)
  const size = box.getSize(new Vector3())
  if (size.z > size.x) { scene.rotation.y = Math.PI / 2; box.setFromObject(scene); box.getSize(size) }
  const scale = 5.6 / size.x
  scene.scale.multiplyScalar(scale)
  box.setFromObject(scene)
  const centre = box.getCenter(new Vector3())
  scene.position.x -= centre.x - (CAR.cgToFront - CAR.cgToRear) / 2
  scene.position.z -= centre.z
  scene.position.y -= box.min.y
  root.add(scene)

  const wheels: { node: Object3D; front: boolean; base: number }[] = []
  let steering: Object3D | null = null
  const hideInCockpit: Object3D[] = []
  scene.traverse(o => {
    const m = o as Mesh
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true }
    const n = o.name.toLowerCase()
    const w = /wheel[_\-. ]?(fl|fr|rl|rr)\b/.exec(n)
    if (w) wheels.push({ node: o, front: w[1][0] === 'f', base: o.rotation.y })
    else if (/steering[_\-. ]?wheel/.test(n)) steering = o
    else if (/helmet|driver/.test(n)) hideInCockpit.push(o)
  })
  return {
    root,
    placeholder: false,
    update(s) {
      for (const w of wheels) {
        w.node.rotation.z = -s.wheelRot
        if (w.front) w.node.rotation.y = w.base - s.steerAngle
      }
      if (steering) (steering as Object3D).rotation.x = s.steerInput * 1.6
    },
    setCockpitView(on) { for (const o of hideInCockpit) o.visible = !on },
    dispose() {
      scene.traverse(o => { const m = o as Mesh; if (m.isMesh) m.geometry.dispose() })
    },
  }
}

export async function loadCarVisual(): Promise<CarVisual> {
  if (await glbAvailable(CAR_GLB_URL)) {
    try {
      const gltf = await new GLTFLoader().loadAsync(CAR_GLB_URL)
      return wrapGlb(gltf.scene)
    } catch (err) {
      console.warn('[car] failed to load GLB, using procedural stand-in', err)
    }
  }
  return buildProceduralCar()
}
