import type { ObservationData } from "../data/JWSTFetcher";
import { mapObservation } from "./DataMapper";

const RAMP_TIME_S = 4.0;

// Base root frequency: A1 = 55 Hz
const ROOT_HZ = 55;
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Chord modes — interval sets in semitones above the root, voiced across ~3 octaves
// 9 intervals, with two high "air" voices that can unfold over time.
export const CHORD_MODES: Record<string, number[]> = {
  MAJ: [0, 7, 12, 16, 19, 24, 31, 36, 43],
  MIN: [0, 7, 12, 15, 19, 24, 31, 36, 43],
  DOM7: [0, 7, 10, 12, 16, 19, 24, 31, 34],
  MAJ7: [0, 7, 11, 12, 16, 19, 24, 31, 35],
  SUS4: [0, 5, 7, 12, 17, 19, 24, 31, 36],
  MIN7: [0, 7, 10, 12, 15, 19, 24, 31, 34],
};

export const CHORD_MODE_NAMES = Object.keys(CHORD_MODES);

// Compute absolute frequencies for a given root (semitones above A1=55Hz) and mode
function buildFreqs(rootSemitones: number, mode: string): number[] {
  const intervals = CHORD_MODES[mode] ?? CHORD_MODES["MAJ"];
  return intervals.map(
    (iv) => ROOT_HZ * Math.pow(2, (rootSemitones + iv) / 12),
  );
}

// Generate a long white-noise decay impulse for convolution reverb
function makeImpulseResponse(
  ctx: AudioContext,
  duration: number,
  decay: number,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * duration);
  const buf = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buf;
}

// Build the granular shimmer layer: 6 short delay lines with randomised
// feedback and individual sine LFOs that wobble their delay times.
// This scatters the sound into overlapping micro-fragments — a close
// approximation of granular cloud texture using only native Web Audio nodes.
interface GrainLine {
  delay: DelayNode;
  feedback: GainNode;
  modOsc: OscillatorNode;
  modGain: GainNode;
  inputGain: GainNode;
  outputGain: GainNode;
}

function buildGrainCloud(
  ctx: AudioContext,
  input: AudioNode,
  output: AudioNode,
  count = 6,
): GrainLine[] {
  const lines: GrainLine[] = [];
  for (let i = 0; i < count; i++) {
    const baseDelay = 0.04 + Math.random() * 0.18; // 40–220 ms
    const modDepth = 0.008 + Math.random() * 0.022; // ±8–30 ms wobble
    const modRate = 0.08 + Math.random() * 0.4; // 0.08–0.48 Hz
    const fbGain = 0.25 + Math.random() * 0.3; // 25–55% feedback

    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = baseDelay;

    const feedback = ctx.createGain();
    feedback.gain.value = fbGain;

    const inputGain = ctx.createGain();
    inputGain.gain.value = 1 / count;

    const outputGain = ctx.createGain();
    outputGain.gain.value = 0.0; // starts silent, fades in

    // LFO wobbles the delay time → pitch-scatter / shimmer
    const modOsc = ctx.createOscillator();
    modOsc.type = "sine";
    modOsc.frequency.value = modRate;

    const modGain = ctx.createGain();
    modGain.gain.value = modDepth;

    modOsc.connect(modGain);
    modGain.connect(delay.delayTime);

    // Signal path: input → inputGain → delay → outputGain → output
    //                                      ↑ feedback ↩
    input.connect(inputGain);
    inputGain.connect(delay);
    delay.connect(outputGain);
    delay.connect(feedback);
    feedback.connect(delay);
    outputGain.connect(output);

    modOsc.start();
    lines.push({ delay, feedback, modOsc, modGain, inputGain, outputGain });
  }
  return lines;
}

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
  driftOsc: OscillatorNode;
  driftGain: GainNode;
}

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private voices: Voice[] = [];
  private grainLines: GrainLine[] = [];
  private grainInputGain: GainNode | null = null; // controls how much raw osc feeds grains
  private grainOutputGain: GainNode | null = null; // controls grain wet level into mix

  private filter: BiquadFilterNode | null = null;
  private convolver: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;

  private rmsBuffer = new Float32Array(1024);
  private blend = 0.8;
  private cutoffOverride: number | null = null;
  private _isStarted = false;
  private _zoomNorm = 0.2; // default: (1.0-0.5)/2.5 for zoomLevel=1.0
  // Per-voice density weight set by data/coords — zoom gates on top of this
  private _voiceDensity = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
  private _rootSemitones = 0; // semitones above A1 for current root
  private _chordMode = "MAJ";
  private _unfoldAmount = 0.25;
  private _evolveTimer: ReturnType<typeof setInterval> | null = null;
  private _pulseAmount = 0.25;

  get isStarted(): boolean {
    return this._isStarted;
  }

  start(ctx: AudioContext): void {
    this.ctx = ctx;
    this._isStarted = true;

    // Analyser
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    // Compressor → analyser → out
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.ratio.value = 4;
    this.compressor.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // Master gain
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.compressor);

    // Reverb
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulseResponse(ctx, 14.0, 1.4); // 14s tail, slower decay

    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 1.0;
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.24;
    this.dryGain.connect(this.masterGain);

    // Lowpass filter — timbral control, not pitch
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 1.2;
    this.filter.connect(this.dryGain);
    this.filter.connect(this.convolver);

    // LFO — modulates master gain for a gentle global swell, not per-voice tremolo
    // lfoGain depth is kept small (≤ 0.05) so it reads as breathing, not fading
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0.02; // ±0.02 amplitude modulation at rest

    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = 0.03;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.masterGain.gain); // modulate master, not each voice
    this.lfo.start();

    // 9 drone voices — chord shape set by root + mode, with two high "air" voices.
    const startFreqs = buildFreqs(this._rootSemitones, this._chordMode);
    for (let i = 0; i < startFreqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = "triangle"; // softer than sawtooth
      osc.frequency.value = startFreqs[i];

      const gain = ctx.createGain();
      gain.gain.value = 0.0;
      const driftOsc = ctx.createOscillator();
      driftOsc.type = "sine";
      driftOsc.frequency.value = 0.004 + Math.random() * 0.03;
      const driftGain = ctx.createGain();
      driftGain.gain.value = 1.5 + Math.random() * 4.5;

      osc.connect(gain);
      gain.connect(this.filter);
      driftOsc.connect(driftGain);
      driftGain.connect(osc.detune);
      osc.start();
      driftOsc.start();

      this.voices.push({ osc, gain, driftOsc, driftGain });
    }

    // ── Granular shimmer layer ────────────────────────────────────────────────
    // Feed the filter output into the grain cloud, then merge back into master
    this.grainInputGain = ctx.createGain();
    this.grainInputGain.gain.value = 0.5; // how much dry signal feeds the grains

    this.grainOutputGain = ctx.createGain();
    this.grainOutputGain.gain.value = 0.0; // starts off, fades in

    this.filter.connect(this.grainInputGain);
    this.grainLines = buildGrainCloud(
      ctx,
      this.grainInputGain,
      this.grainOutputGain,
    );
    this.grainOutputGain.connect(this.reverbGain);

    // Fade master in over 2 s — voice gains are owned entirely by _applyZoom
    const now = ctx.currentTime;
    this.masterGain.gain.linearRampToValueAtTime(0.8, now + 2.0);

    // Apply zoom immediately so voice count matches current zoom level from the start
    this._applyZoom(this._zoomNorm);

    // Fade grain cloud in with a slight delay for a 'bloom' effect
    this.grainLines.forEach((g, i) => {
      g.outputGain.gain.linearRampToValueAtTime(0.6, now + 3.0 + i * 0.15);
    });
    this._startEvolution();
  }

  // Observation data drives: filter colour, reverb space, LFO rate, grain density
  // — pitch is intentionally excluded
  updateFromData(obs: ObservationData): void {
    if (!this.ctx || !this._isStarted) return;
    const p = mapObservation(obs);
    const now = this.ctx.currentTime;
    const ramp = now + RAMP_TIME_S;

    // Filter colour (timbral brightness from Dec)
    if (this.cutoffOverride === null) {
      this.filter?.frequency.linearRampToValueAtTime(p.filterCutoffHz, ramp);
    }

    // Reverb space — scaled up for a much bigger room
    const wet = (0.6 + p.reverbMix * 1.2) * this.blend;
    const dry = Math.max(0.02, 0.2 - p.reverbMix * 0.18);
    this.reverbGain?.gain.linearRampToValueAtTime(wet, ramp);
    this.dryGain?.gain.linearRampToValueAtTime(dry, ramp);

    // LFO breathing rate
    this.lfo?.frequency.linearRampToValueAtTime(p.lfoRateHz, ramp);

    // Store per-voice density weights — zoom will gate these in _applyZoom
    // harmonicCount from data mapper is 1-4; scale it up to the active voice count
    const scaledCount = Math.round((p.harmonicCount / 4) * this.voices.length);
    this.voices.forEach((_, i) => {
      this._voiceDensity[i] = i < scaledCount ? p.density : 0;
    });

    // Grain cloud density (feedback amount) driven by target type density
    this.grainLines.forEach((g) => {
      const fb = 0.2 + p.density * 0.3;
      g.feedback.gain.setTargetAtTime(fb, now, 1.0);
    });

    // Re-assert zoom shape on top of data-driven sweep (TC=0.3 wins over RAMP_TIME_S)
    this._applyZoom(this._zoomNorm);
  }

  // Aim-mode update: position drives timbre/space — NOT pitch
  updateFromCoords(ra: number, dec: number): void {
    if (!this.ctx || !this._isStarted) return;
    const now = this.ctx.currentTime;
    const TC = 0.8; // slow glide for ambient feel

    const tRA = Math.max(0, Math.min(1, ra / 360));
    const tDec = Math.max(0, Math.min(1, (dec + 90) / 180));

    // Filter brightness: vertical axis (Dec) opens/closes timbre
    if (this.cutoffOverride === null) {
      const cutoff = 200 * Math.pow(8, tDec); // 200 Hz (dark bottom) → 1600 Hz (bright top)
      this.filter?.frequency.setTargetAtTime(cutoff, now, TC);
    }

    // Filter resonance: more Q in the upper sky → ethereal ringing
    const q = 0.5 + tDec * 3.5;
    this.filter?.Q.setTargetAtTime(q, now, TC);

    // Reverb depth: right side = deeper space, more reverb
    const wet = (0.5 + tRA * 1.0) * this.blend;
    const dry = Math.max(0.02, 0.2 - tRA * 0.18);
    this.reverbGain?.gain.setTargetAtTime(wet, now, TC);
    this.dryGain?.gain.setTargetAtTime(dry, now, TC);

    // LFO swell depth: subtle variation with sky position
    const lfoDepth = 0.008 + (1 - tDec) * 0.025;
    this.lfoGain?.gain.setTargetAtTime(lfoDepth, now, TC);

    // LFO rate: left = very slow, right = faster undulation
    const lfoRate = 0.008 + tRA * 0.1;
    this.lfo?.frequency.setTargetAtTime(lfoRate, now, TC);

    // Grain shimmer intensity: upper-right (far deep field) = max shimmer
    const shimmer = tRA * 0.5 + tDec * 0.3;
    this.grainLines.forEach((g) => {
      const fb = 0.15 + shimmer * 0.4;
      g.feedback.gain.setTargetAtTime(fb, now, TC);
      const outLevel = 0.3 + shimmer * 0.5;
      g.outputGain.gain.setTargetAtTime(outLevel, now, TC);
    });

    // Grain cloud input feed: more input = denser, smearier texture
    if (this.grainInputGain) {
      this.grainInputGain.gain.setTargetAtTime(0.3 + shimmer * 0.5, now, TC);
    }

    // Store per-voice density weights from sky position — zoom gates these in _applyZoom
    const thresh = Math.round(tDec * (this.voices.length - 1));
    this.voices.forEach((_, i) => {
      this._voiceDensity[i] = i <= thresh ? 1 / Math.sqrt(thresh + 1) : 0;
    });

    // Re-assert zoom shape on top of coord sweep (TC=0.3 wins over TC=0.8)
    this._applyZoom(this._zoomNorm);
  }

  // ── Macro controls ───────────────────────────────────────────────────────────
  // Each knob bundles 2–3 audio parameters into a single expressive gesture.

  setVolume(value: number): void {
    // Master output level
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(
      value * 0.82,
      this.ctx.currentTime,
      0.1,
    );
  }

  // SPACE — reverb size + grain cloud wetness
  // Low: close, dry, present. High: vast cathedral wash, almost fully submerged.
  setSpace(value: number): void {
    this.blend = Math.max(0, Math.min(1, value));
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const wet = 0.32 + value * 1.15;
    const dry = Math.max(0.08, 0.3 - value * 0.16);
    this.reverbGain?.gain.setTargetAtTime(wet, now, 0.4);
    this.dryGain?.gain.setTargetAtTime(dry, now, 0.4);
    // Grain tails also swell — longer feedback at high space
    const grainOut = 0.2 + value * 1.2;
    const grainFb = 0.35 + value * 0.45; // 0.35 → 0.80: long resonant tails
    this.grainLines.forEach((g) => {
      g.outputGain.gain.setTargetAtTime(grainOut, now, 0.6);
      g.feedback.gain.setTargetAtTime(grainFb, now, 0.8);
    });
  }

  // COLOUR — filter cutoff + resonance Q
  // Low: dark, muffled, subterranean. High: bright, singing, ringing.
  setColour(value: number): void {
    this.cutoffOverride = value;
    if (!this.ctx || !this.filter) return;
    const now = this.ctx.currentTime;
    // Cutoff: 120 Hz → 4000 Hz exponential
    const hz = 120 * Math.pow(4000 / 120, value);
    this.filter.frequency.setTargetAtTime(hz, now, 0.3);
    // Q: flat at low end, resonant ring at high end
    const q = 0.5 + value * value * 6;
    this.filter.Q.setTargetAtTime(q, now, 0.3);
  }

  // SCATTER — grain feedback + mod depth + grain input feed
  // Low: minimal shimmer, clean drone. High: smeared, pitch-scattered cloud.
  setScatter(value: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const feedback = 0.05 + value * 0.55; // 5–60% feedback
    const inputFeed = 0.15 + value * 0.65; // how much dry feeds grains
    this.grainLines.forEach((g) => {
      g.feedback.gain.setTargetAtTime(feedback, now, 0.5);
      // Mod depth scales with scatter — more scatter = more pitch wobble
      g.modGain.gain.setTargetAtTime(value * 0.035, now, 0.5);
    });
    if (this.grainInputGain) {
      this.grainInputGain.gain.setTargetAtTime(inputFeed, now, 0.5);
    }
  }

  // PULSE — LFO rate + LFO depth together
  // Low: barely perceptible slow tide. High: gentle rhythmic breathing swell.
  // Depth is kept small (max ±0.05 on masterGain) so it never causes deep fade-outs.
  setPulse(value: number): void {
    if (!this.ctx || !this.lfo || !this.lfoGain) return;
    const now = this.ctx.currentTime;
    this._pulseAmount = clamp(value, 0, 1);
    // Rate: 0.003 Hz (almost still) → 0.22 Hz (strong movement)
    const rate = 0.003 + this._pulseAmount * 0.217;
    // Depth: ±0.005 → ±0.09 (more dramatic breathing)
    const depth = 0.005 + this._pulseAmount * 0.085;
    this.lfo.frequency.setTargetAtTime(rate, now, 0.5);
    this.lfoGain.gain.setTargetAtTime(depth, now, 0.5);
  }

  // ZOOM — harmonic count + shimmer + LFO depth scale with visual zoom
  // value 0–1: 0 = zoomed in (intimate, 1–2 voices), 1 = zoomed out (full chord, blooming shimmer)
  setZoom(value: number): void {
    this._zoomNorm = Math.max(0, Math.min(1, value));
    if (!this.ctx || !this._isStarted) return;
    this._applyZoom(this._zoomNorm);
  }

  private _applyZoom(value: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const TC = 0.4; // fast enough to feel responsive zooming in and out

    // Zoom gates voice count: zoomed out = full chord, zoomed in = root only (never silent).
    // value runs 0→1 (zoomed in → zoomed out).
    //   i=0: always present (threshold = -0.12, so presence=1 even at value=0)
    const thresholds = [-0.12, 0.1, 0.22, 0.34, 0.48, 0.6, 0.72, 0.82, 0.9];
    // Higher voices are quieter; top two are additionally gated by unfold amount.
    const baseGains = [1.0, 0.88, 0.78, 0.64, 0.52, 0.42, 0.32, 0.23, 0.17];
    const MASTER = 0.36 / Math.sqrt(this.voices.length);

    this.voices.forEach((v, i) => {
      // Zoom presence: 0 below threshold, rises to 1 over a 0.12 window
      const presence = Math.max(0, Math.min(1, (value - thresholds[i]) / 0.12));
      // Density from observation/coords shapes the mix but zoom presence is the hard gate
      const unfold =
        i >= this.voices.length - 2 ? 0.15 + 0.85 * this._unfoldAmount : 1;
      const target =
        MASTER * baseGains[i] * presence * this._voiceDensity[i] * unfold;
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(target, now, TC);
    });

    // Grain shimmer: more output + longer tails when zoomed out
    const grainOut = 0.05 + value * 0.7;
    this.grainOutputGain?.gain.setTargetAtTime(grainOut, now, 0.5);
    const feedback = 0.2 + value * 0.3;
    this.grainLines.forEach((g) =>
      g.feedback.gain.setTargetAtTime(feedback, now, 0.5),
    );

    // LFO depth: slightly deeper swell when zoomed out, but never dominant
    const lfoDepth = 0.01 + value * 0.03;
    this.lfoGain?.gain.setTargetAtTime(lfoDepth, now, 0.5);

    // Filter Q: purer ring when zoomed in, flat blend zoomed out
    const q = 2.8 - value * 2.0;
    this.filter?.Q.setTargetAtTime(q, now, 0.5);
  }

  // CHORD — change root and/or mode; glides all oscillators over ~2 s
  setChord(rootSemitones: number, mode: string): void {
    this._rootSemitones = rootSemitones;
    this._chordMode = mode;
    if (!this.ctx || !this._isStarted) return;
    const freqs = buildFreqs(rootSemitones, mode);
    const now = this.ctx.currentTime;
    this.voices.forEach((v, i) => {
      v.osc.frequency.setTargetAtTime(freqs[i], now, 1.5);
    });
  }

  private _startEvolution(): void {
    if (this._evolveTimer || !this.ctx) return;
    this._evolveTimer = setInterval(() => {
      if (!this.ctx || !this._isStarted) return;
      const now = this.ctx.currentTime;
      const e = 0.15 + this._pulseAmount * 0.85;
      // Random-walk unfold for upper chord voices.
      const step = (Math.random() * 2 - 1) * (0.12 + e * 0.34);
      this._unfoldAmount = clamp(this._unfoldAmount + step, 0, 1);

      // Slow movement over timbre + space.
      if (this.filter) {
        const baseHz =
          this.cutoffOverride !== null
            ? 120 * Math.pow(4000 / 120, this.cutoffOverride)
            : this.filter.frequency.value;
        const hz = clamp(
          baseHz * (1 + (Math.random() * 2 - 1) * (0.12 + e * 0.45)),
          140,
          5500,
        );
        this.filter.frequency.setTargetAtTime(hz, now, 2.8);
        const q = clamp(
          this.filter.Q.value + (Math.random() * 2 - 1) * (0.2 + e * 1.4),
          0.3,
          8.0,
        );
        this.filter.Q.setTargetAtTime(q, now, 3.2);
      }

      if (this.reverbGain && this.dryGain) {
        const wetBase = 0.32 + this.blend * 1.15;
        const dryBase = Math.max(0.08, 0.3 - this.blend * 0.16);
        const wet = clamp(
          wetBase + (Math.random() * 2 - 1) * (0.08 + e * 0.35),
          0.15,
          2.2,
        );
        const dry = clamp(
          dryBase + (Math.random() * 2 - 1) * (0.04 + e * 0.14),
          0.03,
          0.5,
        );
        this.reverbGain.gain.setTargetAtTime(wet, now, 3.5);
        this.dryGain.gain.setTargetAtTime(dry, now, 3.5);
      }

      // Slow drift in grain motion keeps texture alive.
      this.grainLines.forEach((g) => {
        const nextRate = 0.03 + Math.random() * (0.12 + e * 0.33);
        g.modOsc.frequency.setTargetAtTime(nextRate, now, 3.5);
        const nextDepth = clamp(
          g.modGain.gain.value + (Math.random() * 2 - 1) * (0.002 + e * 0.014),
          0.003,
          0.06,
        );
        g.modGain.gain.setTargetAtTime(nextDepth, now, 3.5);
        const nextFb = clamp(
          g.feedback.gain.value + (Math.random() * 2 - 1) * (0.03 + e * 0.12),
          0.08,
          0.9,
        );
        g.feedback.gain.setTargetAtTime(nextFb, now, 3.2);
      });

      this.voices.forEach((v) => {
        const nextDrift = clamp(
          v.driftGain.gain.value + (Math.random() * 2 - 1) * (0.8 + e * 6.0),
          0.8,
          24,
        );
        v.driftGain.gain.setTargetAtTime(nextDrift, now, 4.5);
      });

      this._applyZoom(this._zoomNorm);
    }, 5000);
  }

  // Legacy stubs kept so TypeScript doesn't error if called elsewhere
  setBlend(value: number): void {
    this.setSpace(value);
  }
  setCutoff(value: number): void {
    this.setColour(value);
  }
  setLFORate(value: number): void {
    this.setPulse(value);
  }
  setDensity(_value: number): void {
    /* absorbed into SPACE + SCATTER */
  }

  getRMS(): number {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.rmsBuffer);
    let sum = 0;
    for (let i = 0; i < this.rmsBuffer.length; i++) {
      sum += this.rmsBuffer[i] * this.rmsBuffer[i];
    }
    return Math.sqrt(sum / this.rmsBuffer.length);
  }

  stop(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this._evolveTimer !== null) {
      clearInterval(this._evolveTimer);
      this._evolveTimer = null;
    }
    this.masterGain?.gain.linearRampToValueAtTime(0, now + 0.5);
    this.lfo?.stop(now + 0.6);
    this.grainLines.forEach((g) => g.modOsc.stop(now + 0.6));
    this.voices.forEach((v) => {
      v.osc.stop(now + 0.6);
      v.driftOsc.stop(now + 0.6);
    });
    this._isStarted = false;
  }
}
