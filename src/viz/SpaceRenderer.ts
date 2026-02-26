import type { ObservationData } from '../data/JWSTFetcher'

// Deterministic pseudo-random number generator (mulberry32)
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

interface Star {
  x: number; y: number
  brightness: number
  size: number
  twinkleSeed: number
}

interface NebulaParticle {
  x: number; y: number
  r: number; g: number; b: number
  alpha: number
  size: number
  phase: number
  pulseRate: number   // individual breathing rate
  orbitR: number      // radius of slow lazy orbit
  orbitRate: number   // angular speed of orbit
  orbitPhase: number  // starting angle
}

const RING_RADII = [0.18, 0.30, 0.44, 0.60]

export class SpaceRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private stars: Star[] = []
  private nebula: NebulaParticle[] = []
  private animId = 0
  private startTime = performance.now()

  private normalizedRA = 0.42
  private normalizedDec = 0.51
  private rms = 0
  private zoomLevel = 1.0

  // Aim mode: normalized screen coords 0–1, null when inactive
  private aimX: number | null = null
  private aimY: number | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.resize()
    window.addEventListener('resize', () => this.resize())
    this.initStars()
    this.initNebula()
  }

  private resize(): void {
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  private initStars(): void {
    const rng = mulberry32(0xDEADBEEF)
    this.stars = Array.from({ length: 2000 }, () => ({
      x:           rng(),
      y:           rng(),
      brightness:  Math.pow(rng(), 2.5),
      size:        0.5 + rng() * 2,
      twinkleSeed: rng() * Math.PI * 2,
    }))
  }

  private initNebula(): void {
    const rng = mulberry32(0xC0FFEE42)
    // Palette: deep purple, teal, cobalt, violet — kept but subtler
    const palette = [
      [0.35, 0.05, 0.65],
      [0.00, 0.55, 0.80],
      [0.10, 0.20, 0.80],
      [0.50, 0.10, 0.80],
    ]
    // Fewer, larger blobs — they feather more gracefully and don't overstack
    this.nebula = Array.from({ length: 80 }, () => {
      const col = palette[Math.floor(rng() * palette.length)]
      return {
        x:          rng(),
        y:          rng(),
        r:          col[0], g: col[1], b: col[2],
        alpha:      0.010 + rng() * 0.018,   // much lower ceiling
        size:       80 + rng() * 220,         // larger so they spread thin
        phase:      rng() * Math.PI * 2,
        pulseRate:  0.012 + rng() * 0.025,    // each blob breathes at its own rate
        orbitR:     0.004 + rng() * 0.012,    // lazy orbital drift radius (normalised)
        orbitRate:  0.004 + rng() * 0.010,    // very slow angular speed
        orbitPhase: rng() * Math.PI * 2,
      }
    })
  }

  setObservation(obs: ObservationData): void {
    this.normalizedRA  = obs.ra / 360
    this.normalizedDec = (obs.dec + 90) / 180
  }

  // Override RA/Dec directly from pointer position (aim mode)
  setAimCoords(ra: number, dec: number): void {
    this.normalizedRA  = ra / 360
    this.normalizedDec = (dec + 90) / 180
  }

  // Set the screen-space reticle position (null = hidden)
  setAimPoint(x: number | null, y: number | null): void {
    this.aimX = x
    this.aimY = y
  }

  setRMS(rms: number): void {
    this.rms = Math.min(1, rms * 8) // scale up for visibility
  }

  setZoom(z: number): void {
    this.zoomLevel = z
  }

  start(): void {
    const loop = () => {
      this.render()
      this.animId = requestAnimationFrame(loop)
    }
    this.animId = requestAnimationFrame(loop)
  }

  stop(): void {
    cancelAnimationFrame(this.animId)
  }

  private render(): void {
    const { canvas, ctx } = this
    const w = canvas.width
    const h = canvas.height
    const t = (performance.now() - this.startTime) / 1000

    // Background — transparent so generative canvas shows through
    ctx.clearRect(0, 0, w, h)

    const cx = w / 2
    const cy = h / 2
    const scale = Math.min(w, h)

    // Parallax scale: zoomed in = looking at a smaller sky patch = less shift per unit RA/Dec
    const parallaxScale = 1 / this.zoomLevel

    // --- Star field ---
    // Parallax: much larger offset so panning feels like flying through space
    const parallaxX = (this.normalizedRA  - 0.5) * 0.30 * parallaxScale
    const parallaxY = (this.normalizedDec - 0.5) * 0.20 * parallaxScale

    for (const s of this.stars) {
      const twinkle = 0.7 + 0.3 * Math.sin(t * 1.5 + s.twinkleSeed)
      const px = ((s.x + parallaxX + 2) % 1) * w
      const py = ((s.y + parallaxY + 2) % 1) * h
      const alpha = s.brightness * twinkle
      // Stars appear larger when zoomed in
      const size = s.size * this.zoomLevel * (0.8 + 0.2 * twinkle)

      ctx.fillStyle = `rgba(200,220,255,${alpha})`
      ctx.beginPath()
      ctx.arc(px, py, size, 0, Math.PI * 2)
      ctx.fill()
    }

    // --- Audio rings ---
    ctx.save()
    ctx.translate(cx, cy)

    // Color: cycle purple → teal based on time + RA/Dec
    const hueShift = t * 0.03 + this.normalizedRA * 0.3 + this.normalizedDec * 0.2
    const hue1 = (270 + hueShift * 60) % 360  // purple range
    const hue2 = (180 + hueShift * 60) % 360  // teal range

    for (let i = 0; i < RING_RADII.length; i++) {
      const baseR = RING_RADII[i] * scale
      const pulse = this.rms * 0.12 * (i + 1) * Math.sin(t * 0.7 + i * 0.8)
      const r = baseR + pulse * scale
      const alpha = (0.5 - i * 0.08) + this.rms * 0.3
      const lineW = 1.5 + this.rms * 2

      // Blend hue between purple and teal per ring
      const t2 = i / (RING_RADII.length - 1)
      const hue = hue1 + (hue2 - hue1) * t2

      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.strokeStyle = `hsla(${hue},80%,65%,${Math.min(1, alpha)})`
      ctx.lineWidth = lineW
      ctx.stroke()

      // Additive inner glow on beat
      if (this.rms > 0.05) {
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.strokeStyle = `hsla(${hue},100%,85%,${this.rms * 0.3})`
        ctx.lineWidth = lineW * 0.5
        ctx.stroke()
      }
    }

    ctx.restore()

    // --- Aim reticle ---
    if (this.aimX !== null && this.aimY !== null) {
      const rx = this.aimX * w
      const ry = this.aimY * h
      const arm = 14
      const gap = 5
      const pulse = 0.7 + 0.3 * Math.sin(t * 4)

      ctx.save()
      ctx.strokeStyle = `rgba(0,200,220,${pulse})`
      ctx.lineWidth = 1
      ctx.shadowColor = '#00AACC'
      ctx.shadowBlur = 8

      // Circle
      ctx.beginPath()
      ctx.arc(rx, ry, gap + 4, 0, Math.PI * 2)
      ctx.stroke()

      // Cross arms with gap
      ctx.beginPath()
      ctx.moveTo(rx - arm - gap, ry); ctx.lineTo(rx - gap, ry)
      ctx.moveTo(rx + gap, ry);       ctx.lineTo(rx + arm + gap, ry)
      ctx.moveTo(rx, ry - arm - gap); ctx.lineTo(rx, ry - gap)
      ctx.moveTo(rx, ry + gap);       ctx.lineTo(rx, ry + arm + gap)
      ctx.stroke()

      ctx.restore()
    }
  }
}
