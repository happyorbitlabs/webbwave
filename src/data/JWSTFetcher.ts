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

const DEFAULT_OBSERVATION: ObservationData = {
  targetName: 'SMACS 0723',
  ra: 110.84,
  dec: -73.45,
  instrument: 'NIRCam',
  filter: 'F277W',
  targetType: 'galaxy cluster',
  timestamp: new Date(),
}

const POLL_INTERVAL_MS = 60_000

export class JWSTFetcher {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private callback: ObservationCallback | null = null

  start(callback: ObservationCallback): void {
    this.callback = callback

    // Fetch immediately, then poll
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
      const data = await this.fetchFromJWSTApi()
      this.callback?.(data)
    } catch {
      console.warn('JWSTFetcher: all sources failed, using default data')
      this.callback?.({ ...DEFAULT_OBSERVATION, timestamp: new Date() })
    }
  }

  private async fetchFromJWSTApi(): Promise<ObservationData> {
    const res = await fetch('https://jwstapi.com/observation/all?limit=1', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json = await res.json()
    const arr = Array.isArray(json) ? json : json.data
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('Empty response')

    const obs = arr[0]
    return {
      targetName: obs.target_name ?? obs.targetName ?? 'Unknown',
      ra:         Number(obs.s_ra  ?? obs.ra  ?? DEFAULT_OBSERVATION.ra),
      dec:        Number(obs.s_dec ?? obs.dec ?? DEFAULT_OBSERVATION.dec),
      instrument: obs.instrument_name ?? obs.instrumentName ?? 'Unknown',
      filter:     obs.filters ?? obs.filter ?? 'Unknown',
      targetType: obs.target_classification ?? obs.type ?? 'unknown',
      timestamp:  new Date(),
    }
  }
}

export { DEFAULT_OBSERVATION }
