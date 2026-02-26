import type { ObservationData } from "../data/JWSTFetcher";

// ── Deterministic RNG (mulberry32) ────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) & 0xffffff;
  }
  return h;
}

// ── Color palette ─────────────────────────────────────────────────────────────

interface Palette {
  primary: [number, number, number]; // [hue, sat%, lit%]
  secondary: [number, number, number];
  glow: [number, number, number];
}

function filterToWavelength(filter: string): number {
  const digits = filter.replace(/\D/g, "");
  return digits.length > 0 ? parseInt(digits, 10) : 500;
}

function wavelengthToPalette(wl: number): Palette {
  if (wl < 100) {
    return {
      primary: [230, 80, 65],
      secondary: [260, 70, 55],
      glow: [215, 90, 80],
    };
  } else if (wl < 200) {
    return {
      primary: [200, 75, 60],
      secondary: [220, 65, 50],
      glow: [190, 85, 75],
    };
  } else if (wl < 500) {
    return {
      primary: [40, 85, 60],
      secondary: [25, 80, 50],
      glow: [50, 90, 75],
    };
  } else if (wl < 1500) {
    return {
      primary: [10, 80, 45],
      secondary: [350, 75, 40],
      glow: [20, 85, 65],
    };
  } else {
    return {
      primary: [320, 70, 40],
      secondary: [300, 65, 35],
      glow: [330, 80, 60],
    };
  }
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%,${a.toFixed(3)})`;
}

// ── Instrument style flags ────────────────────────────────────────────────────

interface InstrumentStyle {
  detailLevel: number; // 0–1
  thermalBlooms: boolean; // MIRI: warm halos
  spectraStreaks: boolean; // NIRSpec: rainbow lines
  wideField: boolean; // NIRISS: more objects
  minimal: boolean; // FGS: single object
}

function instrumentToStyle(instrument: string): InstrumentStyle {
  const l = instrument.toLowerCase();
  return {
    detailLevel: l.includes("nircam")
      ? 1.0
      : l.includes("nirspec")
        ? 0.8
        : l.includes("niriss")
          ? 0.7
          : l.includes("miri")
            ? 0.6
            : 0.3,
    thermalBlooms: l.includes("miri"),
    spectraStreaks: l.includes("nirspec"),
    wideField: l.includes("niriss"),
    minimal: l.includes("fgs"),
  };
}

// ── Scene data ────────────────────────────────────────────────────────────────

interface SceneObject {
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
  hue: number;
  sat: number;
  lit: number;
  alpha: number;
  phase: number;
  kind: string;
}

interface SceneData {
  type: string;
  palette: Palette;
  style: InstrumentStyle;
  objects: SceneObject[];
  seed: number;
}

// ── Main class ────────────────────────────────────────────────────────────────

export class GenerativeBackground {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private bufA: OffscreenCanvas;
  private bufB: OffscreenCanvas;
  private ctxA: OffscreenCanvasRenderingContext2D;
  private ctxB: OffscreenCanvasRenderingContext2D;
  private useB = false;

  private scene: SceneData | null = null;
  private nextScene: SceneData | null = null;
  private animId = 0;
  private startTime = performance.now();
  private sceneScale = 1.0;
  private crossfadeStart = -Infinity;
  private readonly crossfadeDuration = 3000;

  // Normalized 0–1 sky coords used for parallax shift
  private normalizedRA = 0.5;
  private normalizedDec = 0.5;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;
    this.bufA = new OffscreenCanvas(w, h);
    this.bufB = new OffscreenCanvas(w, h);
    this.ctxA = this.bufA.getContext(
      "2d",
    )! as OffscreenCanvasRenderingContext2D;
    this.ctxB = this.bufB.getContext(
      "2d",
    )! as OffscreenCanvasRenderingContext2D;
    window.addEventListener("resize", () => this.resize());
  }

  setZoom(z: number): void {
    this.sceneScale = z;
  }

  setAimCoords(ra: number, dec: number): void {
    this.normalizedRA = ra / 360;
    this.normalizedDec = (dec + 90) / 180;
  }

  setObservation(obs: ObservationData): void {
    this.normalizedRA = obs.ra / 360;
    this.normalizedDec = (obs.dec + 90) / 180;
    const seed =
      Math.floor(obs.ra * 1000 + (obs.dec + 90) * 100) +
      hashString(obs.targetName);
    const palette = wavelengthToPalette(filterToWavelength(obs.filter));
    const style = instrumentToStyle(obs.instrument);
    const objects = this.buildScene(obs.targetType, seed, palette, style);

    this.nextScene = { type: obs.targetType, palette, style, objects, seed };

    // Render new scene into the back buffer immediately
    this.renderSceneToContext(this.backCtx(), this.nextScene, 0);

    if (!this.scene) {
      // First observation: snap directly, no fade
      this.useB = !this.useB;
      this.scene = this.nextScene;
      this.nextScene = null;
      this.crossfadeStart = -Infinity;
    } else {
      this.crossfadeStart = performance.now();
    }
  }

  start(): void {
    const loop = () => {
      this.render();
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.animId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private frontCtx(): OffscreenCanvasRenderingContext2D {
    return this.useB ? this.ctxB : this.ctxA;
  }

  private backCtx(): OffscreenCanvasRenderingContext2D {
    return this.useB ? this.ctxA : this.ctxB;
  }

  private frontBuf(): OffscreenCanvas {
    return this.useB ? this.bufB : this.bufA;
  }

  private backBuf(): OffscreenCanvas {
    return this.useB ? this.bufA : this.bufB;
  }

  private resize(): void {
    const w = Math.max(1, Math.floor(window.innerWidth * 0.5));
    const h = Math.max(1, Math.floor(window.innerHeight * 0.5));
    this.canvas.width = w;
    this.canvas.height = h;
    this.bufA = new OffscreenCanvas(w, h);
    this.bufB = new OffscreenCanvas(w, h);
    this.ctxA = this.bufA.getContext(
      "2d",
    )! as OffscreenCanvasRenderingContext2D;
    this.ctxB = this.bufB.getContext(
      "2d",
    )! as OffscreenCanvasRenderingContext2D;
    if (this.scene) {
      const t = performance.now() - this.startTime;
      this.renderSceneToContext(this.frontCtx(), this.scene, t);
    }
  }

  private render(): void {
    const { canvas, ctx } = this;
    const t = performance.now() - this.startTime;

    // Re-render current scene with glow animation every frame
    if (this.scene) {
      this.renderSceneToContext(this.frontCtx(), this.scene, t);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const elapsed = performance.now() - this.crossfadeStart;
    const inFade = this.nextScene !== null && elapsed < this.crossfadeDuration;
    const fadeFrac = Math.min(1, elapsed / this.crossfadeDuration);

    if (inFade) {
      ctx.globalAlpha = 1.0;
      ctx.drawImage(this.frontBuf(), 0, 0);
      ctx.globalAlpha = fadeFrac;
      ctx.drawImage(this.backBuf(), 0, 0);
      ctx.globalAlpha = 1.0;

      if (fadeFrac >= 1.0) {
        this.useB = !this.useB;
        this.scene = this.nextScene;
        this.nextScene = null;
      }
    } else if (this.scene) {
      ctx.drawImage(this.frontBuf(), 0, 0);
    }
  }

  // ── Scene builder ─────────────────────────────────────────────────────────────

  private buildScene(
    targetType: string,
    seed: number,
    palette: Palette,
    style: InstrumentStyle,
  ): SceneObject[] {
    const rng = mulberry32(seed);
    const type = targetType.toLowerCase();

    if (type.includes("galaxy cluster") || type.includes("galaxy")) {
      return this.buildGalaxyCluster(rng, palette, style);
    }
    if (type.includes("nebula")) return this.buildNebula(rng, palette, style);
    if (type.includes("star")) return this.buildStar(rng, palette, style);
    return this.buildDeepField(rng, palette, style);
  }

  private buildGalaxyCluster(
    rng: () => number,
    palette: Palette,
    style: InstrumentStyle,
  ): SceneObject[] {
    const objects: SceneObject[] = [];
    const count = style.wideField
      ? 20
      : style.minimal
        ? 5
        : Math.floor(8 + rng() * 12);

    for (let i = 0; i < count; i++) {
      const usePrimary = rng() > 0.4;
      const [h, s, l] = usePrimary ? palette.primary : palette.secondary;
      objects.push({
        x: 0.1 + rng() * 0.8,
        y: 0.1 + rng() * 0.8,
        rx: 0.025 + rng() * 0.07,
        ry: 0,
        angle: rng() * Math.PI,
        hue: h + (rng() - 0.5) * 30,
        sat: s,
        lit: l,
        alpha: 0.1 + rng() * 0.3,
        phase: rng() * Math.PI * 2,
        kind: "galaxy",
      });
    }

    // Gravitational lensing arcs
    const massCx = 0.35 + rng() * 0.3;
    const massCy = 0.35 + rng() * 0.3;
    const arcCount = style.minimal ? 1 : Math.floor(2 + rng() * 4);
    for (let i = 0; i < arcCount; i++) {
      const [h, s, l] = palette.glow;
      objects.push({
        x: massCx,
        y: massCy,
        rx: 0.1 + rng() * 0.18,
        ry: 0.03 + rng() * 0.07,
        angle: rng() * Math.PI,
        hue: h,
        sat: s,
        lit: l + 10,
        alpha: 0.05 + rng() * 0.12,
        phase: rng() * Math.PI * 2,
        kind: "arc",
      });
    }

    return objects;
  }

  private buildNebula(
    rng: () => number,
    palette: Palette,
    style: InstrumentStyle,
  ): SceneObject[] {
    const objects: SceneObject[] = [];
    const cloudCount = style.minimal ? 1 : Math.floor(2 + rng() * 3);

    for (let i = 0; i < cloudCount; i++) {
      const [h, s, l] = i % 2 === 0 ? palette.primary : palette.secondary;
      objects.push({
        x: 0.2 + rng() * 0.6,
        y: 0.2 + rng() * 0.6,
        rx: 0.3 + rng() * 0.5,
        ry: 0,
        angle: 0,
        hue: h + (rng() - 0.5) * 20,
        sat: s,
        lit: l,
        alpha: 0.12 + rng() * 0.18,
        phase: rng() * Math.PI * 2,
        kind: "cloud",
      });
    }

    const filamentCount =
      style.detailLevel > 0.7
        ? Math.floor(6 + rng() * 8)
        : Math.floor(3 + rng() * 5);
    for (let i = 0; i < filamentCount; i++) {
      const [h, s, l] = palette.primary;
      objects.push({
        x: rng(),
        y: rng(),
        rx: rng(),
        ry: rng(),
        angle: rng(),
        hue: h + (rng() - 0.5) * 40,
        sat: s * 0.8,
        lit: l + 20,
        alpha: 0.03 + rng() * 0.07,
        phase: rng() * Math.PI * 2,
        kind: "filament",
      });
    }

    // Bright nebula core
    const [gh, gs, gl] = palette.glow;
    objects.push({
      x: 0.35 + rng() * 0.3,
      y: 0.35 + rng() * 0.3,
      rx: 0.04 + rng() * 0.06,
      ry: 0,
      angle: 0,
      hue: gh,
      sat: gs,
      lit: gl + 15,
      alpha: 0.6 + rng() * 0.3,
      phase: rng() * Math.PI * 2,
      kind: "core",
    });

    return objects;
  }

  private buildStar(
    rng: () => number,
    palette: Palette,
    style: InstrumentStyle,
  ): SceneObject[] {
    const objects: SceneObject[] = [];
    const [gh, gs, gl] = palette.glow;

    // Central star
    objects.push({
      x: 0.4 + rng() * 0.2,
      y: 0.4 + rng() * 0.2,
      rx: 0.025,
      ry: 0,
      angle: (rng() * Math.PI) / 6,
      hue: gh,
      sat: gs,
      lit: gl,
      alpha: 1.0,
      phase: rng() * Math.PI * 2,
      kind: "star",
    });

    // Background field stars
    const fieldCount = style.wideField ? 60 : 25;
    for (let i = 0; i < fieldCount; i++) {
      objects.push({
        x: rng(),
        y: rng(),
        rx: 0.001 + rng() * 0.003,
        ry: 0,
        angle: 0,
        hue: 200 + rng() * 60,
        sat: 30 + rng() * 40,
        lit: 70 + rng() * 25,
        alpha: 0.05 + rng() * 0.25,
        phase: rng() * Math.PI * 2,
        kind: "fieldstar",
      });
    }

    return objects;
  }

  private buildDeepField(
    rng: () => number,
    palette: Palette,
    style: InstrumentStyle,
  ): SceneObject[] {
    const objects: SceneObject[] = [];
    const count = style.wideField
      ? 60
      : style.minimal
        ? 20
        : Math.floor(30 + rng() * 30);

    for (let i = 0; i < count; i++) {
      const [h, s, l] = rng() > 0.5 ? palette.primary : palette.secondary;
      objects.push({
        x: rng(),
        y: rng(),
        rx: 0.005 + rng() * 0.02,
        ry: 0,
        angle: rng() * Math.PI,
        hue: h + (rng() - 0.5) * 40,
        sat: s,
        lit: l,
        alpha: 0.04 + rng() * 0.18,
        phase: rng() * Math.PI * 2,
        kind: "galaxy",
      });
    }

    // Brighter foreground galaxies
    const brightCount = Math.floor(3 + rng() * 5);
    for (let i = 0; i < brightCount; i++) {
      const [h, s, l] = palette.primary;
      objects.push({
        x: 0.1 + rng() * 0.8,
        y: 0.1 + rng() * 0.8,
        rx: 0.015 + rng() * 0.04,
        ry: 0,
        angle: rng() * Math.PI,
        hue: h + (rng() - 0.5) * 15,
        sat: s,
        lit: l,
        alpha: 0.25 + rng() * 0.35,
        phase: rng() * Math.PI * 2,
        kind: "galaxy",
      });
    }

    return objects;
  }

  // ── Scene renderer ────────────────────────────────────────────────────────────

  private renderSceneToContext(
    octx: OffscreenCanvasRenderingContext2D,
    scene: SceneData,
    t: number,
  ): void {
    const w = octx.canvas.width;
    const h = octx.canvas.height;
    const minDim = Math.min(w, h);
    const tSec = t / 1000;

    // Parallax: background shifts opposite to aim direction (deeper layer = less shift than stars)
    const parallaxScale = 1 / this.sceneScale;
    const parallaxOffX = (this.normalizedRA - 0.5) * 0.18 * parallaxScale;
    const parallaxOffY = (this.normalizedDec - 0.5) * 0.12 * parallaxScale;

    octx.fillStyle = "#02020D";
    octx.fillRect(0, 0, w, h);

    for (const obj of scene.objects) {
      const glowPulse = 0.7 + 0.3 * Math.sin(tSec * 0.04 + obj.phase);
      const driftSpeed = obj.kind === "arc" ? 0.045 : 0.02;
      const driftRadius = obj.kind === "arc" ? 5 : 3;
      const driftX = Math.sin(tSec * driftSpeed + obj.phase) * driftRadius;
      const driftY =
        Math.cos(tSec * (driftSpeed * 0.85) + obj.phase + 1.1) * driftRadius;

      const px = ((obj.x + parallaxOffX + 1) % 1) * w + driftX;
      const py = ((obj.y + parallaxOffY + 1) % 1) * h + driftY;
      const rx = obj.rx * minDim * this.sceneScale;
      const alpha = Math.min(1, obj.alpha * glowPulse);

      // Instrument under-layer: drawn before the object so effects feel embedded in the scene
      if (
        scene.style.thermalBlooms &&
        (obj.kind === "galaxy" || obj.kind === "core")
      ) {
        this.drawThermalBloom(octx, px, py, rx * 4.0, obj.hue, alpha * 0.35);
      }

      switch (obj.kind) {
        case "galaxy":
          this.drawGalaxy(
            octx,
            px,
            py,
            rx,
            obj.angle,
            obj.hue,
            obj.sat,
            obj.lit,
            alpha,
            scene.style,
          );
          break;
        case "arc":
          this.drawLensingArc(
            octx,
            px,
            py,
            obj.rx * minDim * this.sceneScale,
            obj.ry * minDim * this.sceneScale,
            obj.angle,
            obj.hue,
            obj.sat,
            obj.lit,
            alpha,
            tSec,
            obj.phase,
          );
          break;
        case "cloud":
          this.drawNebulaCloud(
            octx,
            px,
            py,
            rx,
            obj.hue,
            obj.sat,
            obj.lit,
            alpha,
          );
          break;
        case "filament":
          this.drawFilament(octx, w, h, obj, tSec);
          break;
        case "core":
          this.drawNebulaCore(
            octx,
            px,
            py,
            rx,
            obj.hue,
            obj.sat,
            obj.lit,
            alpha,
            glowPulse,
          );
          break;
        case "star":
          this.drawCentralStar(
            octx,
            px,
            py,
            rx,
            obj.angle,
            obj.hue,
            obj.sat,
            obj.lit,
            minDim,
            scene.style,
            tSec,
            obj.phase,
          );
          break;
        case "fieldstar":
          this.drawFieldStar(
            octx,
            px,
            py,
            rx,
            obj.hue,
            obj.sat,
            obj.lit,
            alpha,
          );
          break;
      }

      // Instrument over-layer: drawn after the object but sized and colored to match scene
      if (
        scene.style.spectraStreaks &&
        (obj.kind === "galaxy" || obj.kind === "cloud")
      ) {
        this.drawSpectraStreak(
          octx,
          px,
          py,
          rx,
          obj.angle,
          obj.hue,
          alpha,
          minDim,
        );
      }
    }

    // Scene-wide diffuse haze
    const [ph, ps, pl] = scene.palette.primary;
    const hazeGrad = octx.createRadialGradient(
      w * 0.5,
      h * 0.5,
      0,
      w * 0.5,
      h * 0.5,
      minDim * 0.65,
    );
    hazeGrad.addColorStop(0, hsl(ph, ps, pl, 0.06));
    hazeGrad.addColorStop(1, "rgba(0,0,0,0)");
    octx.fillStyle = hazeGrad;
    octx.fillRect(0, 0, w, h);
  }

  // ── Drawing primitives ────────────────────────────────────────────────────────

  private drawGalaxy(
    octx: OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    rx: number,
    angle: number,
    hue: number,
    sat: number,
    lit: number,
    alpha: number,
    style: InstrumentStyle,
  ): void {
    const aspectRatio = 0.3 + ((Math.abs(hue) % 100) / 100) * 0.5;

    octx.save();
    octx.translate(cx, cy);
    octx.rotate(angle);
    octx.scale(1, aspectRatio);

    const grad = octx.createRadialGradient(0, 0, 0, 0, 0, rx);
    grad.addColorStop(0, hsl(hue, sat, Math.min(95, lit + 25), alpha));
    grad.addColorStop(0.3, hsl(hue, sat, lit, alpha * 0.7));
    grad.addColorStop(1, hsl(hue, sat, lit * 0.6, 0));
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(0, 0, rx, 0, Math.PI * 2);
    octx.fill();

    if (style.detailLevel >= 0.9) {
      const coreGrad = octx.createRadialGradient(0, 0, 0, 0, 0, rx * 0.3);
      coreGrad.addColorStop(
        0,
        hsl(hue + 15, sat, Math.min(98, lit + 35), alpha * 0.8),
      );
      coreGrad.addColorStop(1, "rgba(0,0,0,0)");
      octx.fillStyle = coreGrad;
      octx.beginPath();
      octx.arc(0, 0, rx * 0.3, 0, Math.PI * 2);
      octx.fill();
    }

    octx.restore();
  }

  private drawLensingArc(
    octx: OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    angle: number,
    hue: number,
    sat: number,
    lit: number,
    alpha: number,
    tSec: number,
    phase: number,
  ): void {
    const breath = 1 + Math.sin(tSec * 0.35 + phase) * 0.04;
    const arcRx = Math.max(1, rx * breath);
    const arcRy = Math.max(1, ry * breath);
    const arcStart = Math.PI * (0.22 + 0.05 * Math.sin(tSec * 0.12 + phase));
    const arcSweep =
      Math.PI * (0.82 + 0.12 * Math.sin(tSec * 0.09 + phase * 0.7));
    const arcEnd = arcStart + arcSweep;

    octx.save();
    octx.translate(cx, cy);
    octx.rotate(angle + Math.sin(tSec * 0.05 + phase) * 0.05);

    // Base arc path with a subtle flowing dash animation.
    octx.setLineDash([Math.max(8, arcRx * 0.2), Math.max(6, arcRx * 0.12)]);
    octx.lineDashOffset = -(tSec * 8 + phase * 20);
    octx.beginPath();
    octx.ellipse(0, 0, arcRx, arcRy, 0, arcStart, arcEnd);
    octx.strokeStyle = hsl(hue, sat, lit, alpha * 0.75);
    octx.lineWidth = 1.1 + alpha * 1.2;
    octx.shadowColor = hsl(hue, sat, lit, 0.3);
    octx.shadowBlur = 5;
    octx.stroke();

    // Traveling highlight segment to make lensing paths feel alive.
    const segmentT = (Math.sin(tSec * 0.22 + phase) + 1) * 0.5;
    const segmentStart = arcStart + arcSweep * segmentT;
    const segmentEnd = Math.min(arcEnd, segmentStart + arcSweep * 0.15);
    octx.setLineDash([]);
    octx.beginPath();
    octx.ellipse(0, 0, arcRx, arcRy, 0, segmentStart, segmentEnd);
    octx.strokeStyle = hsl(hue + 8, sat, Math.min(96, lit + 12), alpha * 1.05);
    octx.lineWidth = 1 + alpha * 1.1;
    octx.shadowColor = hsl(hue + 8, sat, Math.min(96, lit + 12), 0.45);
    octx.shadowBlur = 8;
    octx.stroke();

    octx.restore();
  }

  private drawNebulaCloud(
    octx: OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    hue: number,
    sat: number,
    lit: number,
    alpha: number,
  ): void {
    if (r < 1) return;
    const grad = octx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, hsl(hue, sat, Math.min(90, lit + 20), alpha));
    grad.addColorStop(0.35, hsl(hue, sat, lit, alpha * 0.6));
    grad.addColorStop(0.7, hsl(hue + 15, sat * 0.8, lit * 0.8, alpha * 0.25));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(cx, cy, r, 0, Math.PI * 2);
    octx.fill();
  }

  private drawFilament(
    octx: OffscreenCanvasRenderingContext2D,
    w: number,
    h: number,
    obj: SceneObject,
    tSec: number,
  ): void {
    const sx = obj.x * w;
    const sy = obj.y * h;
    const cpx = obj.rx * w;
    const cpy = obj.ry * h;
    const ex = obj.angle * w;
    const ey = (obj.phase / (Math.PI * 2)) * h;

    const wobble = Math.sin(tSec * 0.015 + obj.phase) * 5;

    octx.save();
    octx.beginPath();
    octx.moveTo(sx, sy);
    octx.quadraticCurveTo(cpx + wobble, cpy + wobble * 0.5, ex, ey);
    octx.strokeStyle = hsl(obj.hue, obj.sat, obj.lit, obj.alpha);
    octx.lineWidth = 0.8 + obj.alpha * 1.5;
    octx.stroke();
    octx.restore();
  }

  private drawNebulaCore(
    octx: OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    hue: number,
    sat: number,
    lit: number,
    alpha: number,
    glowPulse: number,
  ): void {
    if (r < 1) return;
    const outerR = r * 3;
    const grad = octx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
    grad.addColorStop(0, hsl(hue, 20, 98, alpha));
    grad.addColorStop(
      0.2,
      hsl(hue, sat, Math.min(95, lit + 10), alpha * glowPulse),
    );
    grad.addColorStop(0.5, hsl(hue, sat, lit, alpha * 0.4));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(cx, cy, outerR, 0, Math.PI * 2);
    octx.fill();
  }

  private drawCentralStar(
    octx: OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    spikeRotation: number,
    hue: number,
    sat: number,
    lit: number,
    minDim: number,
    style: InstrumentStyle,
    tSec: number,
    phase: number,
  ): void {
    const glowPulse = 0.85 + 0.15 * Math.sin(tSec * 0.05 + phase);

    // Bloom glow
    const bloomR = r * 8 * this.sceneScale;
    if (bloomR > 0) {
      const bloomGrad = octx.createRadialGradient(cx, cy, 0, cx, cy, bloomR);
      bloomGrad.addColorStop(0, hsl(hue, 20, 99, glowPulse));
      bloomGrad.addColorStop(
        0.1,
        hsl(hue, sat, Math.min(95, lit + 5), 0.9 * glowPulse),
      );
      bloomGrad.addColorStop(0.4, hsl(hue, sat, lit, 0.25 * glowPulse));
      bloomGrad.addColorStop(1, "rgba(0,0,0,0)");
      octx.fillStyle = bloomGrad;
      octx.beginPath();
      octx.arc(cx, cy, bloomR, 0, Math.PI * 2);
      octx.fill();
    }

    // Diffraction spikes
    const armCount = style.detailLevel >= 0.9 ? 6 : 4;
    const spikeLen = minDim * 0.35 * this.sceneScale;

    octx.save();
    octx.translate(cx, cy);
    for (let i = 0; i < armCount; i++) {
      const angle = spikeRotation + (i / armCount) * Math.PI * 2;
      const ax = Math.cos(angle);
      const ay = Math.sin(angle);

      const grad = octx.createLinearGradient(
        0,
        0,
        ax * spikeLen,
        ay * spikeLen,
      );
      grad.addColorStop(0, hsl(hue, 40, 98, 0.9));
      grad.addColorStop(0.15, hsl(hue, sat, lit + 10, 0.6));
      grad.addColorStop(0.5, hsl(hue, sat, lit, 0.2));
      grad.addColorStop(1, hsl(hue, sat, lit, 0));

      octx.beginPath();
      octx.moveTo(0, 0);
      octx.lineTo(ax * spikeLen, ay * spikeLen);
      octx.strokeStyle = grad;
      octx.lineWidth = 1.5;
      octx.shadowColor = hsl(hue, sat, lit, 0.4);
      octx.shadowBlur = 8;
      octx.stroke();
    }
    octx.restore();

    // Pinpoint
    if (r * 0.6 > 0) {
      const pinGrad = octx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.6);
      pinGrad.addColorStop(0, "rgba(255,255,255,1)");
      pinGrad.addColorStop(1, hsl(hue, sat, lit, 0));
      octx.fillStyle = pinGrad;
      octx.beginPath();
      octx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
      octx.fill();
    }
  }

  private drawFieldStar(
    octx: OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    hue: number,
    sat: number,
    lit: number,
    alpha: number,
  ): void {
    const gr = Math.max(1, r * 3);
    const grad = octx.createRadialGradient(cx, cy, 0, cx, cy, gr);
    grad.addColorStop(0, hsl(hue, sat, lit, alpha));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(cx, cy, gr, 0, Math.PI * 2);
    octx.fill();
  }

  private drawSpectraStreak(
    octx: OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    angle: number,
    hue: number,
    alpha: number,
    minDim: number,
  ): void {
    // Extend well past the object — streaks feel like light escaping into the scene
    const len = Math.max(r * 6, minDim * 0.12);
    const baseAlpha = alpha * 0.18;

    octx.save();
    octx.translate(cx, cy);
    octx.rotate(angle);

    // Primary dispersion streak — horizon across the object's major axis
    const grad = octx.createLinearGradient(-len, 0, len, 0);
    grad.addColorStop(0, hsl(hue - 60, 80, 65, 0));
    grad.addColorStop(0.15, hsl(hue - 40, 80, 70, baseAlpha));
    grad.addColorStop(0.35, hsl(hue - 10, 75, 75, baseAlpha * 1.4));
    grad.addColorStop(0.5, hsl(hue, 70, 80, baseAlpha * 1.6));
    grad.addColorStop(0.65, hsl(hue + 30, 75, 70, baseAlpha * 1.4));
    grad.addColorStop(0.85, hsl(hue + 60, 80, 65, baseAlpha));
    grad.addColorStop(1, hsl(hue + 80, 80, 60, 0));

    // Draw as a soft band (multiple line widths via blur)
    octx.shadowColor = hsl(hue, 70, 70, baseAlpha * 2);
    octx.shadowBlur = r * 1.2;
    octx.beginPath();
    octx.moveTo(-len, 0);
    octx.lineTo(len, 0);
    octx.strokeStyle = grad;
    octx.lineWidth = Math.max(1.5, r * 0.4);
    octx.stroke();

    // Faint perpendicular cross-dispersion band (narrower, shorter)
    const crossLen = len * 0.25;
    const crossGrad = octx.createLinearGradient(0, -crossLen, 0, crossLen);
    crossGrad.addColorStop(0, hsl(hue + 90, 70, 70, 0));
    crossGrad.addColorStop(0.5, hsl(hue + 90, 70, 75, baseAlpha * 0.6));
    crossGrad.addColorStop(1, hsl(hue + 90, 70, 70, 0));
    octx.shadowBlur = 0;
    octx.beginPath();
    octx.moveTo(0, -crossLen);
    octx.lineTo(0, crossLen);
    octx.strokeStyle = crossGrad;
    octx.lineWidth = Math.max(1, r * 0.2);
    octx.stroke();

    octx.restore();
  }

  private drawThermalBloom(
    octx: OffscreenCanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    hue: number,
    alpha: number,
  ): void {
    if (r < 1) return;
    // Outer diffuse warm envelope — the wide halo that makes the galaxy
    // feel like it's sitting in a pool of infrared heat, not just glowing on top
    const grad = octx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    grad.addColorStop(0, hsl(hue + 30, 85, 75, alpha * 1.2));
    grad.addColorStop(0.25, hsl(hue + 15, 80, 60, alpha * 0.8));
    grad.addColorStop(0.55, hsl(hue, 70, 45, alpha * 0.4));
    grad.addColorStop(0.8, hsl(hue - 10, 60, 35, alpha * 0.15));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(cx, cy, r, 0, Math.PI * 2);
    octx.fill();
  }
}
