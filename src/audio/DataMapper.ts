import type { ObservationData } from '../data/JWSTFetcher'

export interface MappedParams {
  filterCutoffHz: number  // BiquadFilter cutoff — timbral brightness
  reverbMix: number       // 0–1 wet level
  lfoRateHz: number       // 0.005–0.1 Hz breathing speed
  harmonicCount: number   // 1–4 active drone voices
  density: number         // 0–1 overall voice level
}

function decToFilterCutoff(dec: number): number {
  // -90° → 200 Hz (dark/cold), +90° → 1600 Hz (bright/warm)
  const t = (dec + 90) / 180
  return 200 * Math.pow(8, t)
}

function instrumentToHarmonics(instrument: string): number {
  const l = instrument.toLowerCase()
  if (l.includes('nirspec')) return 4
  if (l.includes('nircam'))  return 3
  if (l.includes('miri'))    return 2
  if (l.includes('niriss'))  return 3
  if (l.includes('fgs'))     return 1
  return 3
}

function filterToReverbMix(filter: string): number {
  const digits = filter.replace(/\D/g, '')
  if (digits.length > 0) {
    const wavelength = parseInt(digits, 10)
    return Math.max(0.25, Math.min(0.9, wavelength / 2550))
  }
  return 0.55
}

function targetTypeToDensity(type: string): number {
  const l = type.toLowerCase()
  if (l.includes('nebula'))  return 0.9
  if (l.includes('galaxy'))  return 0.8
  if (l.includes('field'))   return 1.0
  if (l.includes('cluster')) return 0.6
  if (l.includes('star'))    return 0.3
  return 0.5
}

export function mapObservation(obs: ObservationData): MappedParams {
  return {
    filterCutoffHz: decToFilterCutoff(obs.dec),
    reverbMix:      filterToReverbMix(obs.filter),
    lfoRateHz:      0.008 + (obs.ra / 360) * 0.07,
    harmonicCount:  instrumentToHarmonics(obs.instrument),
    density:        targetTypeToDensity(obs.targetType),
  }
}
