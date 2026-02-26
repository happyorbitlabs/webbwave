export interface ObservationData {
  targetName: string;
  ra: number; // 0–360 degrees
  dec: number; // -90 to +90 degrees
  instrument: string;
  filter: string;
  targetType: string;
  timestamp: Date;
}

export type ObservationCallback = (data: ObservationData) => void;

export const DEFAULT_OBSERVATION: ObservationData = {
  targetName: "SMACS 0723",
  ra: 110.84,
  dec: -73.45,
  instrument: "NIRCam",
  filter: "F277W",
  targetType: "galaxy cluster",
  timestamp: new Date(),
};

const POLL_INTERVAL_MS = 60_000;

// In dev: Vite middleware at /api/jwst proxies + caches MAST.
// In prod: Vercel function at /api/jwst does the same.
const API_URL = "/api/jwst";

export class JWSTFetcher {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private callback: ObservationCallback | null = null;

  start(callback: ObservationCallback): void {
    this.callback = callback;
    this.fetch();
    this.intervalId = setInterval(() => this.fetch(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async fetch(): Promise<void> {
    try {
      const data = await this.fetchFromMAST();
      this.callback?.(data);
    } catch (err) {
      console.warn("JWSTFetcher: fetch failed, using default data", err);
      this.callback?.({ ...DEFAULT_OBSERVATION, timestamp: new Date() });
    }
  }

  private async fetchFromMAST(): Promise<ObservationData> {
    // GET /api/jwst in both dev/prod — server-side proxy + cache.
    const res = await fetch(API_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(35_000),
    });

    if (!res.ok) {
      console.warn(
        `JWSTFetcher: upstream unavailable (HTTP ${res.status}), using fallback`,
      );
      return { ...DEFAULT_OBSERVATION, timestamp: new Date() };
    }

    const json = await res.json();
    const results: Record<string, unknown>[] = json.results ?? [];
    if (results.length === 0) {
      return { ...DEFAULT_OBSERVATION, timestamp: new Date() };
    }

    // Skip calibration/engineering frames — find first real science target
    const obs =
      results.find(
        (r) =>
          r.targprop &&
          r.targprop !== "UNKNOWN" &&
          !String(r.exp_type ?? "").match(/DARK|FLAT|BIAS|LAMP|FOCUS/),
      ) ?? results[0];

    return {
      targetName: String(obs.targprop ?? "Unknown"),
      ra: Number(obs.targ_ra ?? DEFAULT_OBSERVATION.ra),
      dec: Number(obs.targ_dec ?? DEFAULT_OBSERVATION.dec),
      instrument: String(obs.instrume ?? "Unknown"),
      filter: String(obs.opticalElements ?? "Unknown"),
      targetType: String(obs.targtype ?? "unknown").toLowerCase(),
      timestamp: new Date(),
    };
  }
}
