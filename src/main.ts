import "./style.css";
import {
  JWSTFetcher,
  DEFAULT_OBSERVATION,
  type ObservationData,
} from "./data/JWSTFetcher";
import { AmbientEngine, CHORD_MODE_NAMES } from "./audio/AmbientEngine";
import { RadioJoveLayer } from "./audio/RadioJoveLayer";
import { SpaceRenderer } from "./viz/SpaceRenderer";
import { GenerativeBackground } from "./viz/GenerativeBackground";
import { InfoOverlay } from "./ui/InfoOverlay";
import { InfoPanel } from "./ui/InfoPanel";

// ── DOM ──────────────────────────────────────────────────────────────────────

const canvas = document.getElementById("space-canvas") as HTMLCanvasElement;
const overlayContainer = document.getElementById("overlay") as HTMLElement;

// Start button
const startBtn = document.createElement("button");
startBtn.id = "start-btn";
startBtn.textContent = "▶  START LISTENING";
document.getElementById("app")!.appendChild(startBtn);

const isiOSLike =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let iosHeadphonesTip: HTMLDivElement | null = null;
if (isiOSLike) {
  iosHeadphonesTip = document.createElement("div");
  iosHeadphonesTip.id = "ios-headphones-tip";
  iosHeadphonesTip.textContent = "HEADPHONES RECOMMENDED";
  document.getElementById("app")!.appendChild(iosHeadphonesTip);
}

// Status badge
const status = document.createElement("div");
status.id = "status";
status.textContent = "LIVE · JAMES WEBB SPACE TELESCOPE";
document.getElementById("app")!.appendChild(status);

// JWST badge
const badge = document.createElement("div");
badge.id = "badge";
badge.innerHTML = "WEBB <span>SYNTH</span>";
document.getElementById("app")!.appendChild(badge);

// Controls panel
const controls = document.createElement("div");
controls.id = "controls";
controls.innerHTML = `
  <div class="knob-group">
    <div class="knob-wrap">
      <input type="range" id="volume-slider" min="0" max="100" value="100" />
      <div class="knob-label">VOLUME</div>
    </div>
    <div class="knob-wrap">
      <input type="range" id="space-slider" min="0" max="100" value="65" />
      <div class="knob-label">SPACE</div>
    </div>
    <div class="knob-wrap">
      <input type="range" id="colour-slider" min="0" max="100" value="40" />
      <div class="knob-label">COLOUR</div>
    </div>
    <div class="knob-wrap">
      <input type="range" id="scatter-slider" min="0" max="100" value="45" />
      <div class="knob-label">SCATTER</div>
    </div>
    <div class="knob-wrap">
      <input type="range" id="pulse-slider" min="0" max="100" value="25" />
      <div class="knob-label">PULSE</div>
    </div>
    <div class="knob-wrap">
      <input type="range" id="signal-slider" min="0" max="100" value="0" />
      <div class="knob-label">SIGNAL</div>
    </div>
  </div>
  <div class="chord-picker" id="chord-picker">
    <div class="piano" id="piano">
      <div class="piano-white-row">
        <button class="pkey white" data-semi="3"  data-note="C">C</button>
        <button class="pkey white" data-semi="5"  data-note="D">D</button>
        <button class="pkey white" data-semi="7"  data-note="E">E</button>
        <button class="pkey white" data-semi="8"  data-note="F">F</button>
        <button class="pkey white" data-semi="10" data-note="G">G</button>
        <button class="pkey white active" data-semi="0" data-note="A">A</button>
        <button class="pkey white" data-semi="2"  data-note="B">B</button>
      </div>
      <div class="piano-black-row">
        <button class="pkey black" data-semi="4"  data-note="C♯"></button>
        <button class="pkey black" data-semi="6"  data-note="D♯"></button>
        <button class="pkey black" data-semi="9"  data-note="F♯"></button>
        <button class="pkey black" data-semi="11" data-note="G♯"></button>
        <button class="pkey black" data-semi="1"  data-note="A♯"></button>
      </div>
    </div>
    <div class="mode-row" id="mode-row">
      ${CHORD_MODE_NAMES.map((m, i) => `<button class="mode-btn${i === 0 ? " active" : ""}" data-mode="${m}">${m}</button>`).join("")}
    </div>
  </div>
`;
document.getElementById("app")!.appendChild(controls);

// Generative background canvas — rendered at 50% resolution, CSS-scaled to fill
const genCanvas = document.createElement("canvas");
genCanvas.id = "generative-canvas";
genCanvas.setAttribute("aria-hidden", "true");
genCanvas.width = Math.max(1, Math.floor(window.innerWidth * 0.5));
genCanvas.height = Math.max(1, Math.floor(window.innerHeight * 0.5));
document.getElementById("app")!.insertBefore(genCanvas, canvas);

// ── Core instances ────────────────────────────────────────────────────────────

const renderer = new SpaceRenderer(canvas);
const generativeBg = new GenerativeBackground(genCanvas);
const overlay = new InfoOverlay(overlayContainer);
const engine = new AmbientEngine();
const signalLayer = new RadioJoveLayer();
const fetcher = new JWSTFetcher();
new InfoPanel(document.getElementById("app")!);

// Show default observation immediately (no audio yet)
renderer.setObservation(DEFAULT_OBSERVATION);
generativeBg.setObservation(DEFAULT_OBSERVATION);
overlay.update(DEFAULT_OBSERVATION);

// Start animation loops right away (no audio)
renderer.start();
generativeBg.start();

// ── Controls wiring ───────────────────────────────────────────────────────────

const spaceSlider = document.getElementById("space-slider") as HTMLInputElement;
const colourSlider = document.getElementById(
  "colour-slider",
) as HTMLInputElement;
const scatterSlider = document.getElementById(
  "scatter-slider",
) as HTMLInputElement;
const pulseSlider = document.getElementById("pulse-slider") as HTMLInputElement;
const volumeSlider = document.getElementById(
  "volume-slider",
) as HTMLInputElement;
const signalSlider = document.getElementById(
  "signal-slider",
) as HTMLInputElement;

function mapSignalSlider(value01: number): number {
  const clamped = Math.max(0, Math.min(1, value01));
  // Taper response and cap max so SIGNAL sits behind the melodic drone.
  return Math.pow(clamped, 1.5) * 0.7;
}

spaceSlider.addEventListener("input", () => {
  const v = Number(spaceSlider.value) / 100;
  engine.setSpace(v);
  signalLayer.setSpace(v);
});

colourSlider.addEventListener("input", () => {
  const v = Number(colourSlider.value) / 100;
  engine.setColour(v);
  signalLayer.setColour(v);
});

scatterSlider.addEventListener("input", () => {
  const v = Number(scatterSlider.value) / 100;
  engine.setScatter(v);
  signalLayer.setScatter(v);
});

pulseSlider.addEventListener("input", () => {
  const v = Number(pulseSlider.value) / 100;
  engine.setPulse(v);
  signalLayer.setPulse(v);
});

volumeSlider.addEventListener("input", () => {
  engine.setVolume(Number(volumeSlider.value) / 100);
});

signalSlider.addEventListener("input", () => {
  signalLayer.setLevel(mapSignalSlider(Number(signalSlider.value) / 100));
});

// Chord picker — piano keys + mode buttons
let chordRoot = 0; // semitones above A1
let chordMode = "MAJ";

const piano = document.getElementById("piano")!;
const modeRow = document.getElementById("mode-row")!;

piano.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(
    ".pkey[data-semi]",
  ) as HTMLElement | null;
  if (!btn) return;
  chordRoot = Number(btn.dataset.semi);
  piano.querySelectorAll(".pkey").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  engine.setChord(chordRoot, chordMode);
});

modeRow.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(
    ".mode-btn",
  ) as HTMLElement | null;
  if (!btn) return;
  chordMode = btn.dataset.mode ?? "MAJ";
  modeRow
    .querySelectorAll(".mode-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  engine.setChord(chordRoot, chordMode);
});

// ── Aim / sky-drag ────────────────────────────────────────────────────────────

let aimActive = false;
let returnTimer: ReturnType<typeof setTimeout> | null = null;
let lastLiveStatus = "LIVE · JAMES WEBB SPACE TELESCOPE";
let lastObservation: ObservationData = DEFAULT_OBSERVATION;
const recentObservations: ObservationData[] = [DEFAULT_OBSERVATION];
let aimedObservation: ObservationData | null = null;

// ── Zoom ──────────────────────────────────────────────────────────────────────

let zoomLevel = 1.0;
let pinchStartDist: number | null = null;
let pinchStartZoom = 1.0;

function clampZoom(z: number) {
  return Math.max(0.5, Math.min(3.0, z));
}

function applyZoom(z: number) {
  zoomLevel = z;
  renderer.setZoom(z);
  generativeBg.setZoom(z);
  const zoomNorm = 1 - (z - 0.5) / 2.5; // remap [0.5, 3.0] → [1, 0]: zoomed out = full chord
  engine.setZoom(zoomNorm);
}

function screenToSky(
  clientX: number,
  clientY: number,
): { ra: number; dec: number } {
  const ra = (clientX / window.innerWidth) * 360;
  const dec = 90 - (clientY / window.innerHeight) * 180;
  return { ra, dec };
}

function addRecentObservation(obs: ObservationData) {
  const last = recentObservations[recentObservations.length - 1];
  const sameAsLast =
    last &&
    last.targetName === obs.targetName &&
    last.instrument === obs.instrument &&
    last.filter === obs.filter &&
    Math.abs(last.ra - obs.ra) < 0.001 &&
    Math.abs(last.dec - obs.dec) < 0.001;
  if (!sameAsLast) recentObservations.push(obs);
  if (recentObservations.length > 64) recentObservations.shift();
}

function raDeltaDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function nearestObservation(ra: number, dec: number): ObservationData {
  let best = recentObservations[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const obs of recentObservations) {
    const dRa = raDeltaDeg(ra, obs.ra) / 180;
    const dDec = Math.abs(dec - obs.dec) / 180;
    const score = dRa * dRa + dDec * dDec;
    if (score < bestScore) {
      bestScore = score;
      best = obs;
    }
  }
  return best;
}

function onAimMove(clientX: number, clientY: number) {
  const { ra, dec } = screenToSky(clientX, clientY);
  const nx = clientX / window.innerWidth;
  const ny = clientY / window.innerHeight;

  const obs = nearestObservation(ra, dec);
  if (obs !== aimedObservation) {
    aimedObservation = obs;
    renderer.setObservation(obs);
    generativeBg.setObservation(obs);
  }

  renderer.setAimCoords(ra, dec);
  renderer.setAimPoint(nx, ny);
  generativeBg.setAimCoords(ra, dec);

  if (engine.isStarted) engine.updateFromCoords(ra, dec);
  signalLayer.scanAtCoords(ra, dec);

  overlay.setCoords(ra, dec);

  const raSgn = ra.toFixed(1);
  const decSgn = (dec >= 0 ? "+" : "") + dec.toFixed(1);
  status.textContent = `AIM · RA ${raSgn}° · DEC ${decSgn}°`;
}

function onAimStart(clientX: number, clientY: number) {
  if (returnTimer !== null) {
    clearTimeout(returnTimer);
    returnTimer = null;
  }
  aimActive = true;
  aimedObservation = null;
  canvas.classList.add("aiming");
  signalLayer.beginScan();
  onAimMove(clientX, clientY);
}

function onAimEnd() {
  aimActive = false;
  canvas.classList.remove("aiming");
  renderer.setAimPoint(null, null);

  returnTimer = setTimeout(() => {
    status.textContent = lastLiveStatus;
    engine.updateFromData(lastObservation);
    renderer.setObservation(lastObservation);
    generativeBg.setObservation(lastObservation);
    overlay.resetCoords(lastObservation.ra, lastObservation.dec);
    signalLayer.endScan();
    signalLayer.setObservation(lastObservation);
    aimedObservation = null;
    returnTimer = null;
  }, 3000);
}

canvas.addEventListener("pointerdown", (e) => {
  // Only drag on the canvas itself, not bubbled from UI
  if (e.target !== canvas) return;
  // Ignore second touch finger (pinch gesture — handled by touch events)
  if (e.pointerType === "touch" && !e.isPrimary) return;
  canvas.setPointerCapture(e.pointerId);
  onAimStart(e.clientX, e.clientY);
});

canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch" && !e.isPrimary) return;
  if (aimActive) {
    onAimMove(e.clientX, e.clientY);
  } else if (status.classList.contains("visible")) {
    // Show live sky coords on hover even without dragging
    const { ra, dec } = screenToSky(e.clientX, e.clientY);
    overlay.setCoords(ra, dec);
    const raSgn = ra.toFixed(1);
    const decSgn = (dec >= 0 ? "+" : "") + dec.toFixed(1);
    status.textContent = `RA ${raSgn}° · DEC ${decSgn}°`;
  }
});

canvas.addEventListener("pointerleave", () => {
  if (!aimActive && status.classList.contains("visible")) {
    status.textContent = lastLiveStatus;
    overlay.resetCoords(lastObservation.ra, lastObservation.dec);
  }
});

canvas.addEventListener("pointerup", () => {
  if (!aimActive) return;
  onAimEnd();
});

canvas.addEventListener("pointercancel", () => {
  if (!aimActive) return;
  onAimEnd();
});

// ── Zoom — scroll wheel (desktop) ────────────────────────────────────────────

canvas.addEventListener(
  "wheel",
  (e: WheelEvent) => {
    e.preventDefault();
    // Normalise deltaY: line mode (Firefox) → pixels
    const deltaPixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    applyZoom(clampZoom(zoomLevel * (1 - deltaPixels * 0.001)));
  },
  { passive: false },
);

// ── Zoom — pinch gesture (mobile) ────────────────────────────────────────────

canvas.addEventListener(
  "touchstart",
  (e: TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      pinchStartZoom = zoomLevel;
    }
  },
  { passive: false },
);

canvas.addEventListener(
  "touchmove",
  (e: TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDist !== null) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      applyZoom(clampZoom(pinchStartZoom * (dist / pinchStartDist)));
    }
  },
  { passive: false },
);

canvas.addEventListener("touchend", () => {
  pinchStartDist = null;
});

// ── RMS → renderer tick ───────────────────────────────────────────────────────

function tick() {
  if (engine.isStarted) {
    renderer.setRMS(engine.getRMS());
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ── Start button ──────────────────────────────────────────────────────────────

async function startAudio() {
  startBtn.classList.add("hidden");
  iosHeadphonesTip?.classList.add("hidden");

  // Web Audio requires user gesture — create context here
  const audioCtx = new AudioContext();
  await audioCtx.resume();

  engine.setSpace(Number(spaceSlider.value) / 100);
  engine.setColour(Number(colourSlider.value) / 100);
  engine.setScatter(Number(scatterSlider.value) / 100);
  engine.setPulse(Number(pulseSlider.value) / 100);
  engine.setVolume(Number(volumeSlider.value) / 100);
  engine.start(audioCtx);

  // Connect Signal layer into the same audio graph (routes to destination directly)
  signalLayer.connect(audioCtx, audioCtx.destination);
  signalLayer.setSpace(Number(spaceSlider.value) / 100);
  signalLayer.setColour(Number(colourSlider.value) / 100);
  signalLayer.setScatter(Number(scatterSlider.value) / 100);
  signalLayer.setPulse(Number(pulseSlider.value) / 100);
  signalLayer.setLevel(mapSignalSlider(Number(signalSlider.value) / 100));
  signalLayer.setObservation(DEFAULT_OBSERVATION);

  // Apply default data immediately so audio starts
  engine.updateFromData(DEFAULT_OBSERVATION);

  // Begin live JWST polling
  fetcher.start((data) => {
    lastObservation = data;
    addRecentObservation(data);
    lastLiveStatus = `LIVE · ${data.targetName.toUpperCase()} · ${data.instrument}`;

    // Only push updates to audio/visuals if user isn't manually aiming
    if (!aimActive) {
      engine.updateFromData(data);
      renderer.setObservation(data);
      generativeBg.setObservation(data);
      overlay.update(data);
      signalLayer.setObservation(data);
      status.textContent = lastLiveStatus;
    }
  });

  // Show status and flip button to stop mode
  status.classList.add("visible");
  startBtn.textContent = "■  STOP";
  startBtn.classList.add("stop-mode");
  startBtn.classList.remove("hidden");
}

function stopAudio() {
  engine.stop();
  signalLayer.stop();
  fetcher.stop();
  status.classList.remove("visible");
  startBtn.textContent = "▶  START LISTENING";
  startBtn.classList.remove("stop-mode");
  iosHeadphonesTip?.classList.remove("hidden");
}

startBtn.addEventListener("click", () => {
  if (engine.isStarted) {
    stopAudio();
  } else {
    startAudio();
  }
});
