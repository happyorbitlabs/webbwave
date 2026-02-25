import type { ObservationData } from '../data/JWSTFetcher'
import { mapObservation } from './DataMapper'

const RAMP_TIME_S = 4.0

// Fixed drone chord: A1 / E2 / A2 / C#3 (open fifth + major third, root 55 Hz)
const DRONE_FREQS = [55, 82.41, 110, 138.59] as const

// Generate a long white-noise decay impulse for convolution reverb
function makeImpulseResponse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
  const sr = ctx.sampleRate
  const length = Math.floor(sr * duration)
  const buf = ctx.createBuffer(2, length, sr)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  return buf
}

// Build the granular shimmer layer: 6 short delay lines with randomised
// feedback and individual sine LFOs that wobble their delay times.
// This scatters the sound into overlapping micro-fragments — a close
// approximation of granular cloud texture using only native Web Audio nodes.
interface GrainLine {
  delay: DelayNode
  feedback: GainNode
  modOsc: OscillatorNode
  modGain: GainNode
  inputGain: GainNode
  outputGain: GainNode
}

function buildGrainCloud(
  ctx: AudioContext,
  input: AudioNode,
  output: AudioNode,
  count = 6,
): GrainLine[] {
  const lines: GrainLine[] = []
  for (let i = 0; i < count; i++) {
    const baseDelay = 0.04 + Math.random() * 0.18   // 40–220 ms
    const modDepth  = 0.008 + Math.random() * 0.022  // ±8–30 ms wobble
    const modRate   = 0.08  + Math.random() * 0.4    // 0.08–0.48 Hz
    const fbGain    = 0.25  + Math.random() * 0.30   // 25–55% feedback

    const delay    = ctx.createDelay(0.5)
    delay.delayTime.value = baseDelay

    const feedback  = ctx.createGain()
    feedback.gain.value = fbGain

    const inputGain  = ctx.createGain()
    inputGain.gain.value = 1 / count

    const outputGain = ctx.createGain()
    outputGain.gain.value = 0.0   // starts silent, fades in

    // LFO wobbles the delay time → pitch-scatter / shimmer
    const modOsc  = ctx.createOscillator()
    modOsc.type = 'sine'
    modOsc.frequency.value = modRate

    const modGain = ctx.createGain()
    modGain.gain.value = modDepth

    modOsc.connect(modGain)
    modGain.connect(delay.delayTime)

    // Signal path: input → inputGain → delay → outputGain → output
    //                                      ↑ feedback ↩
    input.connect(inputGain)
    inputGain.connect(delay)
    delay.connect(outputGain)
    delay.connect(feedback)
    feedback.connect(delay)
    outputGain.connect(output)

    modOsc.start()
    lines.push({ delay, feedback, modOsc, modGain, inputGain, outputGain })
  }
  return lines
}

interface Voice {
  osc: OscillatorNode
  gain: GainNode
}

export class AmbientEngine {
  private ctx: AudioContext | null = null
  private voices: Voice[] = []
  private grainLines: GrainLine[] = []
  private grainInputGain: GainNode | null = null   // controls how much raw osc feeds grains
  private grainOutputGain: GainNode | null = null  // controls grain wet level into mix

  private filter: BiquadFilterNode | null = null
  private convolver: ConvolverNode | null = null
  private reverbGain: GainNode | null = null
  private dryGain: GainNode | null = null
  private masterGain: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private analyser: AnalyserNode | null = null
  private lfo: OscillatorNode | null = null
  private lfoGain: GainNode | null = null

  private rmsBuffer = new Float32Array(1024)
  private blend = 0.8
  private cutoffOverride: number | null = null
  private _isStarted = false
  private _zoomNorm = 0.2   // default: (1.0-0.5)/2.5 for zoomLevel=1.0

  get isStarted(): boolean { return this._isStarted }

  start(ctx: AudioContext): void {
    this.ctx = ctx
    this._isStarted = true

    // Analyser
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024

    // Compressor → analyser → out
    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.threshold.value = -18
    this.compressor.ratio.value = 4
    this.compressor.connect(this.analyser)
    this.analyser.connect(ctx.destination)

    // Master gain
    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = 0
    this.masterGain.connect(this.compressor)

    // Reverb
    this.convolver = ctx.createConvolver()
    this.convolver.buffer = makeImpulseResponse(ctx, 6.0, 2.0)

    this.reverbGain = ctx.createGain()
    this.reverbGain.gain.value = 0.6
    this.convolver.connect(this.reverbGain)
    this.reverbGain.connect(this.masterGain)

    this.dryGain = ctx.createGain()
    this.dryGain.gain.value = 0.3
    this.dryGain.connect(this.masterGain)

    // Lowpass filter — timbral control, not pitch
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 1200
    this.filter.Q.value = 1.2
    this.filter.connect(this.dryGain)
    this.filter.connect(this.convolver)

    // LFO for amplitude swell
    this.lfoGain = ctx.createGain()
    this.lfoGain.gain.value = 0.10

    this.lfo = ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.value = 0.03
    this.lfo.connect(this.lfoGain)
    this.lfo.start()

    // 4 fixed-pitch drone voices — frequencies NEVER change
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'           // softer than sawtooth
      osc.frequency.value = DRONE_FREQS[i]

      const gain = ctx.createGain()
      gain.gain.value = 0.0
      this.lfoGain!.connect(gain.gain)

      osc.connect(gain)
      gain.connect(this.filter)
      osc.start()

      this.voices.push({ osc, gain })
    }

    // ── Granular shimmer layer ────────────────────────────────────────────────
    // Feed the filter output into the grain cloud, then merge back into master
    this.grainInputGain = ctx.createGain()
    this.grainInputGain.gain.value = 0.5   // how much dry signal feeds the grains

    this.grainOutputGain = ctx.createGain()
    this.grainOutputGain.gain.value = 0.0  // starts off, fades in

    this.filter.connect(this.grainInputGain)
    this.grainLines = buildGrainCloud(ctx, this.grainInputGain, this.grainOutputGain)
    this.grainOutputGain.connect(this.reverbGain)

    // Fade all voices and grain in over 2 s
    const now = ctx.currentTime
    this.masterGain.gain.linearRampToValueAtTime(0.7, now + 2.0)
    this.voices.forEach((v, i) => {
      const targetG = (0.25 / Math.sqrt(4)) * [1.0, 0.9, 0.8, 0.6][i]
      v.gain.gain.linearRampToValueAtTime(targetG, now + 2.0)
    })
    // Fade grain cloud in with a slight delay for a 'bloom' effect
    this.grainLines.forEach((g, i) => {
      g.outputGain.gain.linearRampToValueAtTime(0.6, now + 3.0 + i * 0.15)
    })

    // Re-assert zoom shape after initial fade-in ramp settles
    setTimeout(() => this._applyZoom(this._zoomNorm), 2200)
  }

  // Observation data drives: filter colour, reverb space, LFO rate, grain density
  // — pitch is intentionally excluded
  updateFromData(obs: ObservationData): void {
    if (!this.ctx || !this._isStarted) return
    const p = mapObservation(obs)
    const now = this.ctx.currentTime
    const ramp = now + RAMP_TIME_S

    // Filter colour (timbral brightness from Dec)
    if (this.cutoffOverride === null) {
      this.filter?.frequency.linearRampToValueAtTime(p.filterCutoffHz, ramp)
    }

    // Reverb space
    const wet = p.reverbMix * this.blend
    const dry = Math.max(0.1, 1 - wet * 0.6)
    this.reverbGain?.gain.linearRampToValueAtTime(wet, ramp)
    this.dryGain?.gain.linearRampToValueAtTime(dry, ramp)

    // LFO breathing rate
    this.lfo?.frequency.linearRampToValueAtTime(p.lfoRateHz, ramp)

    // Voice density: how many harmonics are active and at what level
    this.voices.forEach((v, i) => {
      const active = i < p.harmonicCount
      const g = active ? (0.25 / Math.sqrt(p.harmonicCount)) * p.density : 0
      v.gain.gain.linearRampToValueAtTime(g, ramp)
    })

    // Grain cloud density (feedback amount) driven by target type density
    this.grainLines.forEach(g => {
      const fb = 0.20 + p.density * 0.30
      g.feedback.gain.setTargetAtTime(fb, now, 1.0)
    })

    // Re-assert zoom shape on top of data-driven sweep (TC=0.3 wins over RAMP_TIME_S)
    this._applyZoom(this._zoomNorm)
  }

  // Aim-mode update: position drives timbre/space — NOT pitch
  updateFromCoords(ra: number, dec: number): void {
    if (!this.ctx || !this._isStarted) return
    const now = this.ctx.currentTime
    const TC = 0.8   // slow glide for ambient feel

    const tRA  = Math.max(0, Math.min(1, ra / 360))
    const tDec = Math.max(0, Math.min(1, (dec + 90) / 180))

    // Filter brightness: vertical axis (Dec) opens/closes timbre
    if (this.cutoffOverride === null) {
      const cutoff = 200 * Math.pow(8, tDec)   // 200 Hz (dark bottom) → 1600 Hz (bright top)
      this.filter?.frequency.setTargetAtTime(cutoff, now, TC)
    }

    // Filter resonance: more Q in the upper sky → ethereal ringing
    const q = 0.5 + tDec * 3.5
    this.filter?.Q.setTargetAtTime(q, now, TC)

    // Reverb depth: right side = deeper space, more reverb
    const wet = 0.3 + tRA * 0.55 * this.blend
    const dry = Math.max(0.05, 1 - wet * 0.7)
    this.reverbGain?.gain.setTargetAtTime(wet, now, TC)
    this.dryGain?.gain.setTargetAtTime(dry, now, TC)

    // LFO swell depth: lower sky = slower, deeper breathing
    const lfoDepth = 0.03 + (1 - tDec) * 0.20
    this.lfoGain?.gain.setTargetAtTime(lfoDepth, now, TC)

    // LFO rate: left = very slow, right = faster undulation
    const lfoRate = 0.008 + tRA * 0.10
    this.lfo?.frequency.setTargetAtTime(lfoRate, now, TC)

    // Grain shimmer intensity: upper-right (far deep field) = max shimmer
    const shimmer = tRA * 0.5 + tDec * 0.3
    this.grainLines.forEach(g => {
      const fb = 0.15 + shimmer * 0.40
      g.feedback.gain.setTargetAtTime(fb, now, TC)
      const outLevel = 0.3 + shimmer * 0.5
      g.outputGain.gain.setTargetAtTime(outLevel, now, TC)
    })

    // Grain cloud input feed: more input = denser, smearier texture
    if (this.grainInputGain) {
      this.grainInputGain.gain.setTargetAtTime(0.3 + shimmer * 0.5, now, TC)
    }

    // Voice presence: lower sky = fewer active harmonics (sparse), upper = full chord
    this.voices.forEach((v, i) => {
      const thresh = Math.round(tDec * 3)  // 0 voices at bottom, 3 more added at top
      const active = i <= thresh
      const g = active ? (0.25 / Math.sqrt(thresh + 1)) : 0
      v.gain.gain.setTargetAtTime(g, now, TC)
    })

    // Re-assert zoom shape on top of coord sweep (TC=0.3 wins over TC=0.8)
    this._applyZoom(this._zoomNorm)
  }

  // ── Macro controls ───────────────────────────────────────────────────────────
  // Each knob bundles 2–3 audio parameters into a single expressive gesture.

  setVolume(value: number): void {
    // Master output level
    if (!this.ctx || !this.masterGain) return
    this.masterGain.gain.setTargetAtTime(value * 0.7, this.ctx.currentTime, 0.1)
  }

  // SPACE — reverb size + grain cloud wetness
  // Low: close, dry, present. High: vast, diffuse, submerged.
  setSpace(value: number): void {
    this.blend = Math.max(0, Math.min(1, value))
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const wet = 0.15 + value * 0.75
    const dry = Math.max(0.05, 1 - wet * 0.65)
    this.reverbGain?.gain.setTargetAtTime(wet, now, 0.4)
    this.dryGain?.gain.setTargetAtTime(dry, now, 0.4)
    // Grain output tracks space — more space = more shimmer in the tail
    const grainOut = 0.1 + value * 0.7
    this.grainLines.forEach(g => g.outputGain.gain.setTargetAtTime(grainOut, now, 0.6))
  }

  // COLOUR — filter cutoff + resonance Q
  // Low: dark, muffled, subterranean. High: bright, singing, ringing.
  setColour(value: number): void {
    this.cutoffOverride = value
    if (!this.ctx || !this.filter) return
    const now = this.ctx.currentTime
    // Cutoff: 120 Hz → 4000 Hz exponential
    const hz = 120 * Math.pow(4000 / 120, value)
    this.filter.frequency.setTargetAtTime(hz, now, 0.3)
    // Q: flat at low end, resonant ring at high end
    const q = 0.5 + value * value * 6
    this.filter.Q.setTargetAtTime(q, now, 0.3)
  }

  // SCATTER — grain feedback + mod depth + grain input feed
  // Low: minimal shimmer, clean drone. High: smeared, pitch-scattered cloud.
  setScatter(value: number): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const feedback = 0.05 + value * 0.55    // 5–60% feedback
    const inputFeed = 0.15 + value * 0.65   // how much dry feeds grains
    this.grainLines.forEach(g => {
      g.feedback.gain.setTargetAtTime(feedback, now, 0.5)
      // Mod depth scales with scatter — more scatter = more pitch wobble
      g.modGain.gain.setTargetAtTime(value * 0.035, now, 0.5)
    })
    if (this.grainInputGain) {
      this.grainInputGain.gain.setTargetAtTime(inputFeed, now, 0.5)
    }
  }

  // PULSE — LFO rate + LFO depth together
  // Low: barely perceptible slow tide. High: deep, rhythmic breathing swell.
  setPulse(value: number): void {
    if (!this.ctx || !this.lfo || !this.lfoGain) return
    const now = this.ctx.currentTime
    // Rate: 0.003 Hz (almost still) → 0.18 Hz (noticeable pulse)
    const rate = 0.003 + value * 0.177
    // Depth: whisper → heavy swell
    const depth = 0.01 + value * 0.22
    this.lfo.frequency.setTargetAtTime(rate, now, 0.5)
    this.lfoGain.gain.setTargetAtTime(depth, now, 0.5)
  }

  // ZOOM — harmonic count + shimmer + LFO depth scale with visual zoom
  // value 0–1: 0 = zoomed in (intimate, 1–2 voices), 1 = zoomed out (full chord, blooming shimmer)
  setZoom(value: number): void {
    this._zoomNorm = Math.max(0, Math.min(1, value))
    if (!this.ctx || !this._isStarted) return
    this._applyZoom(this._zoomNorm)
  }

  private _applyZoom(value: number): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const TC  = 0.3   // settles faster than any other ramp — zoom always wins

    // Voice presence: fade harmonics in as zoom goes out
    // i=0 (55 Hz): always present. i=3 (C#3): only when zoomed far out.
    const baseGains = [1.0, 0.9, 0.8, 0.6]
    this.voices.forEach((v, i) => {
      const presence = Math.max(0, Math.min(1, value * 4 - i + 1))
      const target   = (0.25 / Math.sqrt(4)) * baseGains[i] * presence
      v.gain.gain.setTargetAtTime(target, now, TC)
    })

    // Grain shimmer: more output + longer tails when zoomed out
    const grainOut = 0.1 + value * 0.65
    this.grainOutputGain?.gain.setTargetAtTime(grainOut, now, TC)
    const feedback = 0.25 + value * 0.25
    this.grainLines.forEach(g => g.feedback.gain.setTargetAtTime(feedback, now, TC))

    // LFO depth: wider swell when zoomed out
    const lfoDepth = 0.05 + value * 0.13
    this.lfoGain?.gain.setTargetAtTime(lfoDepth, now, TC)

    // Filter Q: purer single-frequency ring when zoomed in, flatter blend zoomed out
    const q = 2.5 - value * 1.7
    this.filter?.Q.setTargetAtTime(q, now, TC)
  }

  // Legacy stubs kept so TypeScript doesn't error if called elsewhere
  setBlend(value: number): void { this.setSpace(value) }
  setCutoff(value: number): void { this.setColour(value) }
  setLFORate(value: number): void { this.setPulse(value) }
  setDensity(_value: number): void { /* absorbed into SPACE + SCATTER */ }

  getRMS(): number {
    if (!this.analyser) return 0
    this.analyser.getFloatTimeDomainData(this.rmsBuffer)
    let sum = 0
    for (let i = 0; i < this.rmsBuffer.length; i++) {
      sum += this.rmsBuffer[i] * this.rmsBuffer[i]
    }
    return Math.sqrt(sum / this.rmsBuffer.length)
  }

  stop(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this.masterGain?.gain.linearRampToValueAtTime(0, now + 0.5)
    this.lfo?.stop(now + 0.6)
    this.grainLines.forEach(g => g.modOsc.stop(now + 0.6))
    this.voices.forEach(v => v.osc.stop(now + 0.6))
    this._isStarted = false
  }
}
