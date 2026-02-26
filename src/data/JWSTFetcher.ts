export interface ObservationData {
  targetName: string
  ra: number        // 0–360 degrees
  dec: number       // -90 to +90 degrees
  instrument: string
  filter: string
  targetType: string
  timestamp: Date
}

export type ObservationCallback = (data: ObservationData) => void

export const DEFAULT_OBSERVATION: ObservationData = {
  targetName: 'SMACS 0723',
  ra: 110.84,
  dec: -73.45,
  instrument: 'NIRCam',
  filter: 'F277W',
  targetType: 'galaxy cluster',
  timestamp: new Date(),
}

const POLL_INTERVAL_MS = 60_000

// MAST JWST search API — POST, returns most-recent science observations
// Excludes calibration frames (DARK/FLAT/BIAS) and unknown targets
const MAST_BODY = JSON.stringify({
  limit: 10,
  sort_by: ['date_obs'],
  sort_desc: [true],
  select_cols: ['targprop', 'targ_ra', 'targ_dec', 'instrume', 'opticalElements', 'targtype', 'exp_type'],
  skip_count: true,   // omits totalResults count — cuts response time dramatically
})

// In dev: proxy through Vite (/mast → mast.stsci.edu) to avoid CORS
// In prod: Vercel Edge Function at /api/jwst handles the upstream fetch
const API_URL = import.meta.env.DEV ? '/mast/search/jwst/api/v0.1/search' : '/api/jwst'

export class JWSTFetcher {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private callback: ObservationCallback | null = null

  start(callback: ObservationCallback): void {
    this.callback = callback
    this.fetch()
    this.intervalId = setInterval(() => this.fetch(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  private async fetch(): Promise<void> {
    try {
      const data = await this.fetchFromMAST()
      this.callback?.(data)
    } catch (err) {
      console.warn('JWSTFetcher: fetch failed, using default data', err)
      this.callback?.({ ...DEFAULT_OBSERVATION, timestamp: new Date() })
    }
  }

  private async fetchFromMAST(): Promise<ObservationData> {
    // Dev: POST directly to MAST via Vite proxy
    // Prod: GET /api/jwst — Node.js function with in-memory cache serves instantly after first hit
    const isProd = !import.meta.env.DEV
    const res = await fetch(API_URL, {
      method: isProd ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: isProd ? undefined : MAST_BODY,
      signal: AbortSignal.timeout(120_000),  // cold Vercel cache can take ~90s on first request
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json = await res.json()
    const results: Record<string, unknown>[] = json.results ?? []
    if (results.length === 0) throw new Error('Empty response')

    // Skip calibration/engineering frames — find first real science target
    const obs = results.find(r =>
      r.targprop && r.targprop !== 'UNKNOWN' &&
      !String(r.exp_type ?? '').match(/DARK|FLAT|BIAS|LAMP|FOCUS/)
    ) ?? results[0]

    return {
      targetName: String(obs.targprop ?? 'Unknown'),
      ra:         Number(obs.targ_ra  ?? DEFAULT_OBSERVATION.ra),
      dec:        Number(obs.targ_dec ?? DEFAULT_OBSERVATION.dec),
      instrument: String(obs.instrume ?? 'Unknown'),
      filter:     String(obs.opticalElements ?? 'Unknown'),
      targetType: String(obs.targtype ?? 'unknown').toLowerCase(),
      timestamp:  new Date(),
    }
  }
}

