export type QualityName = 'low' | 'medium' | 'high' | 'ultra'

export interface QualitySettings {
  label: string
  /** device-pixel-ratio range; adaptive resolution moves inside it */
  dpr: [number, number]
  shadows: boolean
  shadowMapSize: number
  /** post-processing pipeline on/off (off = straight forward render with MSAA) */
  post: boolean
  msaa: number
  ao: boolean
  aoHalfRes: boolean
  bloom: boolean
  motionBlur: boolean
  anisotropy: number
  /** scenery density 0..1 (trees) */
  detail: number
  clouds: boolean
}

export const QUALITY: Record<QualityName, QualitySettings> = {
  low: {
    label: 'Low', dpr: [0.6, 1], shadows: false, shadowMapSize: 1024, post: false, msaa: 0,
    ao: false, aoHalfRes: true, bloom: false, motionBlur: false, anisotropy: 2, detail: 0.35, clouds: false,
  },
  medium: {
    label: 'Medium', dpr: [0.75, 1.25], shadows: true, shadowMapSize: 2048, post: true, msaa: 2,
    ao: false, aoHalfRes: true, bloom: true, motionBlur: false, anisotropy: 4, detail: 0.6, clouds: true,
  },
  high: {
    label: 'High', dpr: [0.8, 1.5], shadows: true, shadowMapSize: 2048, post: true, msaa: 4,
    ao: true, aoHalfRes: true, bloom: true, motionBlur: true, anisotropy: 8, detail: 0.85, clouds: true,
  },
  ultra: {
    label: 'Ultra', dpr: [1, 2], shadows: true, shadowMapSize: 4096, post: true, msaa: 8,
    ao: true, aoHalfRes: false, bloom: true, motionBlur: true, anisotropy: 16, detail: 1, clouds: true,
  },
}

/**
 * Phones and tablets get the same four presets with tighter budgets: lower
 * resolution ceiling, smaller shadow maps, half-resolution AO, less MSAA and
 * sparser scenery. Mobile GPUs are fill-rate limited, so resolution matters most.
 */
export function resolveQuality(name: QualityName, mobile: boolean): QualitySettings {
  const q = QUALITY[name]
  if (!mobile) return q
  return {
    ...q,
    dpr: name === 'low' ? [0.7, 1.15] : [0.7, Math.min(q.dpr[1], name === 'ultra' ? 2 : 1.5)],
    shadowMapSize: Math.min(q.shadowMapSize, name === 'ultra' ? 2048 : 1024),
    msaa: Math.min(q.msaa, 2),
    aoHalfRes: true,
    motionBlur: q.motionBlur && name === 'ultra',
    anisotropy: Math.min(q.anisotropy, 4),
    detail: q.detail * 0.7,
  }
}

export const QUALITY_ORDER: QualityName[] = ['low', 'medium', 'high', 'ultra']
