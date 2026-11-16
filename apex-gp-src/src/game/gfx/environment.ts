import { DataUtils, EquirectangularReflectionMapping, HalfFloatType, Vector3, type DataTexture } from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'

export const HDR_URL = 'hdr/rooitou_park_1k.hdr'

export interface EnvAsset { texture: DataTexture; sun: Vector3; /** environmentRotation.y aligning the HDRI sun with `sun` */ rotationY: number }

/** world-space azimuth of the sun (atan2(z, x)) */
const SUN_AZIMUTH = Math.atan2(0.55, -0.8)

/**
 * Loads the HDRI used for image-based lighting and finds the sun in it, so the
 * directional light, shadows and procedural sky all agree with the reflections.
 */
export async function loadEnvironment(onProgress?: (f: number) => void): Promise<EnvAsset> {
  const texture = await new RGBELoader().loadAsync(HDR_URL, e => { if (e.total) onProgress?.(e.loaded / e.total) })
  texture.mapping = EquirectangularReflectionMapping
  const { data, width, height } = texture.image as unknown as { data: Uint16Array | Float32Array; width: number; height: number }
  const half = texture.type === HalfFloatType
  const lum = (i: number) => {
    const r = half ? DataUtils.fromHalfFloat(data[i]) : data[i]
    const g = half ? DataUtils.fromHalfFloat(data[i + 1]) : data[i + 1]
    const b = half ? DataUtils.fromHalfFloat(data[i + 2]) : data[i + 2]
    return r * 0.2126 + g * 0.7152 + b * 0.0722
  }
  let max = 0
  for (let i = 0; i < width * height; i++) max = Math.max(max, lum(i * 4))
  const sun = new Vector3()
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const l = lum((y * width + x) * 4)
    if (l < max * 0.5) continue
    // equirect, same convention as three's equirectUv(); file row 0 is the top of the image
    const phi = ((x + 0.5) / width - 0.5) * Math.PI * 2
    const theta = (0.5 - (y + 0.5) / height) * Math.PI
    sun.x += Math.cos(theta) * Math.cos(phi) * l
    sun.y += Math.sin(theta) * l
    sun.z += Math.cos(theta) * Math.sin(phi) * l
  }
  if (sun.lengthSq() < 1e-9) sun.set(0.4, 0.7, 0.3)
  sun.normalize()
  // Rotate the whole environment about Y so the sun sits where the circuit
  // wants it (low-ish, behind-right of the grid: long readable shadows that
  // do not put the start straight in the shade of the grandstands).
  const hdrAz = Math.atan2(sun.z, sun.x)
  const elevation = Math.max(0.6, Math.min(0.95, Math.asin(Math.abs(sun.y))))
  const rotationY = hdrAz - SUN_AZIMUTH
  sun.set(Math.cos(elevation) * Math.cos(SUN_AZIMUTH), Math.sin(elevation), Math.cos(elevation) * Math.sin(SUN_AZIMUTH))
  return { texture, sun, rotationY }
}
