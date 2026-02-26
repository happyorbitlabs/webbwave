// RadioJoveLayer — NASA space transmission recordings run through a
// granular cloud + lowpass filter + convolution reverb chain, selected
// and cross-faded automatically based on the live JWST observation.
//
// Sources (all bundled in public/audio/ — same-origin, no CORS):
//   chorus.wav    — Earth magnetosphere plasma waves (Van Allen Probes / NASA GSFC Polar)
//   m74-jwst.mp3  — M74 Phantom Galaxy JWST infrared sonification (Chandra / NASA)
//   jellyfish.mp3 — IC 443 Jellyfish Nebula multi-wavelength sonification (Chandra + JWST)
//   tycho.mp3     — Tycho's Supernova Remnant X-ray sonification (Chandra)
//   m87.mp3       — M87 galaxy + black hole jet sonification (Chandra + JWST)
//
// Observation → track selection:
//   galaxy / galaxy cluster → m74, m87, chorus, jellyfish, tycho
//   nebula / supernova      → jellyfish, tycho, chorus, m74, m87
//   star                    → tycho, chorus, m74, m87, jellyfish
//   default / unknown       → all tracks
//
// Within the active track set the layer performs a slow autonomous random walk —
// every 30–90 s it picks a new active track and cross-fades to it over ~8 s.
// The RA coordinate seeds the initial offset so sky positions feel distinct.
//
// The SIGNAL slider controls only the overall wet level — how much the space
// transmissions blend into the rest of the soundscape.
//
// SPACE / COLOUR / SCATTER / PULSE are forwarded from the shared knobs and
// shape the grain cloud + filter + reverb identically to AmbientEngine.

import type { ObservationData } from "../data/JWSTFetcher";

const TRACKS = {
  chorus: "/audio/chorus.wav",
  m74: "/audio/m74-jwst.mp3",
  jellyfish: "/audio/jellyfish.mp3",
  tycho: "/audio/tycho.mp3",
  m87: "/audio/m87.mp3",
} as const;

type TrackKey = keyof typeof TRACKS;
const ALL_TRACKS: TrackKey[] = ["chorus", "m74", "jellyfish", "tycho", "m87"];

// Which tracks are active for a given observation
function tracksForObservation(obs: ObservationData): TrackKey[] {
  const type = obs.targetType.toLowerCase();
  if (
    type.includes("galaxy") ||
    type.includes("cluster") ||
    type.includes("quasar")
  ) {
    return ["m74", "m87", "chorus", "jellyfish", "tycho"];
  }
  if (
    type.includes("nebula") ||
    type.includes("supernova") ||
    type.includes("remnant")
  ) {
    return ["jellyfish", "tycho", "chorus", "m74", "m87"];
  }
  if (type.includes("star") || type.includes("stellar")) {
    return ["tycho", "chorus", "m74", "m87", "jellyfish"];
  }
  return ALL_TRACKS;
}

// Seeded pseudo-random — deterministic from RA so same position → same starting feel
function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 0xffffffff;
  };
}

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
    const baseDelay = 0.04 + Math.random() * 0.18;
    const modDepth = 0.008 + Math.random() * 0.022;
    const modRate = 0.08 + Math.random() * 0.4;
    const fbGain = 0.25 + Math.random() * 0.3;

    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = baseDelay;

    const feedback = ctx.createGain();
    feedback.gain.value = fbGain;

    const inputGain = ctx.createGain();
    inputGain.gain.value = 1 / count;

    const outputGain = ctx.createGain();
    outputGain.gain.value = 0.0;

    const modOsc = ctx.createOscillator();
    modOsc.type = "sine";
    modOsc.frequency.value = modRate;

    const modGain = ctx.createGain();
    modGain.gain.value = modDepth;

    modOsc.connect(modGain);
    modGain.connect(delay.delayTime);

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

export class RadioJoveLayer {
  // One gain node per track — all always connected; only the active one is non-zero
  private trackGains: Partial<Record<TrackKey, GainNode>> = {};
  private trackEls: Partial<Record<TrackKey, HTMLAudioElement>> = {};

  private grainInputGain: GainNode | null = null;
  private grainOutputGain: GainNode | null = null;
  private grainLines: GrainLine[] = [];

  private filter: BiquadFilterNode | null = null;
  private convolver: ConvolverNode | null = null;
  private dryGain: GainNode | null = null;
  private reverbGain: GainNode | null = null;
  private masterGain: GainNode | null = null;

  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;

  private _level = 0.0;
  private _ready = false;
  private _activeTracks: TrackKey[] = ALL_TRACKS;
  private _currentTrack: TrackKey = "chorus";
  private _walkTimer: ReturnType<typeof setTimeout> | null = null;
  private _rand: () => number = seededRand(42);
  private _scanMode = false;

  connect(ctx: AudioContext, destination: AudioNode): void {
    // Master output — starts silent
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(destination);

    // Convolution reverb
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulseResponse(ctx, 10.0, 1.4);

    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 1.0;
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.masterGain);

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.15;
    this.dryGain.connect(this.masterGain);

    // Lowpass filter
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 1.0;
    this.filter.connect(this.dryGain);
    this.filter.connect(this.convolver);

    // LFO on master gain
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 0.02;

    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = 0.03;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.masterGain.gain);
    this.lfo.start();

    // Grain cloud
    this.grainInputGain = ctx.createGain();
    this.grainInputGain.gain.value = 0.5;

    this.grainOutputGain = ctx.createGain();
    this.grainOutputGain.gain.value = 0.0;

    this.grainLines = buildGrainCloud(
      ctx,
      this.grainInputGain,
      this.grainOutputGain,
    );
    this.grainOutputGain.connect(this.reverbGain);

    // All 5 tracks wired up, gains start at 0
    for (const [key, url] of Object.entries(TRACKS) as [TrackKey, string][]) {
      const el = new Audio();
      el.loop = true;
      el.preload = "none";
      el.src = url;
      this.trackEls[key] = el;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.filter!);
      gain.connect(this.grainInputGain!);

      const src = ctx.createMediaElementSource(el);
      src.connect(gain);
      this.trackGains[key] = gain;
    }

    this._ready = true;
  }

  // Called when a new JWST observation arrives
  setObservation(obs: ObservationData): void {
    const newTracks = tracksForObservation(obs);

    // Reseed random walk from RA so different sky positions feel distinct
    this._rand = seededRand(Math.floor(obs.ra * 100 + (obs.dec + 90) * 10));
    this._activeTracks = newTracks;

    // Pick a starting track deterministically from the seed
    const startIdx = Math.floor(this._rand() * newTracks.length);
    const nextTrack = newTracks[startIdx];

    if (nextTrack !== this._currentTrack) {
      this._crossfadeTo(nextTrack);
    }

    // Restart the walk timer with the new set
    this._scheduleNextWalk();
  }

  // Aim mode: tune through transmissions directly from sky position.
  beginScan(): void {
    this._scanMode = true;
    this._clearWalkTimer();
  }

  // RA chooses track lane; Dec controls crossfade speed.
  scanAtCoords(ra: number, dec: number): void {
    if (!this._ready || !this.masterGain || !this._scanMode) return;
    const tRA = Math.max(0, Math.min(1, ra / 360));
    const tDec = Math.max(0, Math.min(1, (dec + 90) / 180));
    const idx = Math.min(
      ALL_TRACKS.length - 1,
      Math.floor(tRA * ALL_TRACKS.length),
    );
    const nextTrack = ALL_TRACKS[idx];
    if (nextTrack === this._currentTrack) return;
    const tc = 0.18 + (1 - tDec) * 0.35;
    this._crossfadeTo(nextTrack, tc);
  }

  endScan(): void {
    if (!this._scanMode) return;
    this._scanMode = false;
    this._scheduleNextWalk();
  }

  // level 0–1: overall blend into the soundscape
  setLevel(level: number): void {
    this._level = Math.max(0, Math.min(1, level));
    if (!this.masterGain || !this._ready) return;

    const now = this.masterGain.context.currentTime;

    if (this._level > 0 && !this._anyPlaying()) {
      this._startAll(now);
    }

    this.masterGain.gain.setTargetAtTime(this._level * 0.55, now, 0.4);
  }

  // SPACE — reverb size + grain wetness
  setSpace(value: number): void {
    if (!this.reverbGain || !this.dryGain) return;
    const now = this.reverbGain.context.currentTime;
    this.reverbGain.gain.setTargetAtTime(0.4 + value * 1.4, now, 0.4);
    this.dryGain.gain.setTargetAtTime(
      Math.max(0.02, 0.25 - value * 0.22),
      now,
      0.4,
    );
    const grainOut = 0.2 + value * 1.2;
    const grainFb = 0.35 + value * 0.45;
    this.grainLines.forEach((g) => {
      g.outputGain.gain.setTargetAtTime(grainOut, now, 0.6);
      g.feedback.gain.setTargetAtTime(grainFb, now, 0.8);
    });
  }

  // COLOUR — lowpass cutoff + resonance Q
  setColour(value: number): void {
    if (!this.filter) return;
    const now = this.filter.context.currentTime;
    this.filter.frequency.setTargetAtTime(
      120 * Math.pow(4000 / 120, value),
      now,
      0.3,
    );
    this.filter.Q.setTargetAtTime(0.5 + value * value * 6, now, 0.3);
  }

  // SCATTER — grain feedback + mod depth + input feed
  setScatter(value: number): void {
    if (!this.grainInputGain) return;
    const now = this.grainInputGain.context.currentTime;
    this.grainLines.forEach((g) => {
      g.feedback.gain.setTargetAtTime(0.05 + value * 0.55, now, 0.5);
      g.modGain.gain.setTargetAtTime(value * 0.035, now, 0.5);
    });
    this.grainInputGain.gain.setTargetAtTime(0.15 + value * 0.65, now, 0.5);
  }

  // PULSE — LFO rate + depth
  setPulse(value: number): void {
    if (!this.lfo || !this.lfoGain) return;
    const now = this.lfo.context.currentTime;
    this.lfo.frequency.setTargetAtTime(0.003 + value * 0.147, now, 0.5);
    this.lfoGain.gain.setTargetAtTime(0.005 + value * 0.045, now, 0.5);
  }

  stop(): void {
    this._scanMode = false;
    this._clearWalkTimer();
    for (const el of Object.values(this.trackEls)) el?.pause();
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        0,
        this.masterGain.context.currentTime,
        0.3,
      );
    }
    try {
      this.lfo?.stop();
    } catch {
      /* already stopped */
    }
    this.grainLines.forEach((g) => {
      try {
        g.modOsc.stop();
      } catch {
        /* already stopped */
      }
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _crossfadeTo(next: TrackKey, tc = 0.8): void {
    if (!this.masterGain) return;
    const ctx = this.masterGain.context;
    const now = ctx.currentTime;

    // Fade out current
    const outGain = this.trackGains[this._currentTrack];
    outGain?.gain.setTargetAtTime(0, now, tc);

    // Fade in next
    const inGain = this.trackGains[next];
    inGain?.gain.setTargetAtTime(1, now, tc);

    this._currentTrack = next;
  }

  private _scheduleNextWalk(): void {
    if (this._scanMode) return;
    this._clearWalkTimer();
    // Walk interval: 30–90 s, seeded so it varies per observation
    const delay = (30 + this._rand() * 60) * 1000;
    this._walkTimer = setTimeout(() => this._doWalkStep(), delay);
  }

  private _doWalkStep(): void {
    if (this._scanMode) return;
    // Pick a different track from the active set
    const others = this._activeTracks.filter((t) => t !== this._currentTrack);
    if (others.length > 0) {
      const next = others[Math.floor(this._rand() * others.length)];
      this._crossfadeTo(next);
    }
    this._scheduleNextWalk();
  }

  private _clearWalkTimer(): void {
    if (this._walkTimer !== null) {
      clearTimeout(this._walkTimer);
      this._walkTimer = null;
    }
  }

  private _anyPlaying(): boolean {
    return Object.values(this.trackEls).some((el) => el && !el.paused);
  }

  private _startAll(now: number): void {
    // Start all tracks playing (they're all silenced by gain=0 except active one)
    for (const el of Object.values(this.trackEls)) {
      el?.play().catch(() => {});
    }
    // Set active track gain to 1
    const g = this.trackGains[this._currentTrack];
    g?.gain.setTargetAtTime(1, now, 0.3);
    // Bloom grain cloud in
    this.grainLines.forEach((g, i) => {
      g.outputGain.gain.linearRampToValueAtTime(0.6, now + 2.0 + i * 0.1);
    });
    // Start the autonomous walk
    this._scheduleNextWalk();
  }
}
