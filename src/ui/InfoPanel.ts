export class InfoPanel {
  private panel: HTMLElement;
  private btn: HTMLElement;
  private open = false;

  constructor(appEl: HTMLElement) {
    // ── Toggle button ─────────────────────────────────────────────────────────
    this.btn = document.createElement("button");
    this.btn.id = "info-btn";
    this.btn.textContent = "?";
    this.btn.setAttribute("aria-label", "About Webb Synth");
    this.btn.setAttribute("aria-expanded", "false");
    appEl.appendChild(this.btn);

    // ── Panel ─────────────────────────────────────────────────────────────────
    this.panel = document.createElement("div");
    this.panel.id = "info-panel";
    this.panel.setAttribute("aria-hidden", "true");
    this.panel.innerHTML = `
      <div class="ip-body">
        <p class="ip-lead">
          A live ambient soundscape driven by the James Webb Space Telescope's
          actual observation schedule — updated every&nbsp;60&nbsp;seconds.
        </p>

        <div class="ip-section">
          <div class="ip-section-title">WHAT YOU'RE HEARING</div>
          <div class="ip-row">
            <span class="ip-label">CHORD</span>
            <span class="ip-value">Pick a root note on the piano keyboard and a mode (MAJ MIN DOM7 MAJ7 SUS4 MIN7) — oscillators retune smoothly</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">VOICES</span>
            <span class="ip-value">Zoom out to open the full harmonic spectrum; zoom in to collapse to a single fundamental</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">COLOUR</span>
            <span class="ip-value">Timbral brightness mapped from the telescope's active optical filter wavelength</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SPACE</span>
            <span class="ip-value">Convolution reverb depth — large hall at high values; longer IR wavelengths push it further</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SCATTER</span>
            <span class="ip-value">Granular cloud — 6-voice feedback delay network simulating deep-space grain scatter</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">PULSE</span>
            <span class="ip-value">LFO swell — slow global amplitude breath over the master mix</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SIGNAL</span>
            <span class="ip-value">Real NASA space transmissions — source selection and crossfades driven by the live JWST observation type (galaxy, nebula, star); the layer walks autonomously between recordings every 30–90 s. Controls the blend level into the soundscape.</span>
          </div>
        </div>

        <div class="ip-section">
          <div class="ip-section-title">WHAT YOU'RE SEEING</div>
          <div class="ip-row">
            <span class="ip-label">SCENE TYPE</span>
            <span class="ip-value">Generated from target classification — galaxy clusters, nebulae, stars, and deep fields each render differently</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">PALETTE</span>
            <span class="ip-value">Colour temperature from the active optical filter — UV blue through NIR amber to deep-red MIRI wavelengths</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">DETAIL</span>
            <span class="ip-value">Instrument drives style — NIRCam: core highlights; NIRSpec: spectral streaks; MIRI: thermal bloom halos</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">LAYOUT</span>
            <span class="ip-value">Seeded from RA / Dec — the same sky position always produces the same procedural scene</span>
          </div>
        </div>

        <div class="ip-section">
          <div class="ip-section-title">CONTROLS</div>
          <div class="ip-row">
            <span class="ip-label">PIANO</span>
            <span class="ip-value">Select root note (C–B) and chord mode — updates all 7 oscillator voices in real time</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">DRAG</span>
            <span class="ip-value">Aim anywhere on the canvas to synthesise a custom sky position — timbre and visuals update live</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SCROLL / PINCH</span>
            <span class="ip-value">Zoom in to isolate the root; zoom out to bloom the full harmonic stack</span>
          </div>
        </div>

        <div class="ip-section">
          <div class="ip-section-title">LIVE DATA</div>
          <div class="ip-row">
            <span class="ip-label">JWST API</span>
            <span class="ip-value">MAST / STScI — Webb's current observation: target name, RA / Dec, instrument, filter — polled every 60 s, cached server-side</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SPACE AUDIO</span>
            <span class="ip-value">NASA plasma wave recordings (Van Allen Probes / Polar mission), JWST infrared sonifications (Chandra), and nebula multi-wavelength audio — all real instrument data</span>
          </div>
        </div>
      </div>
    `;
    appEl.appendChild(this.panel);

    // ── Event wiring ─────────────────────────────────────────────────────────
    this.btn.addEventListener("click", () => this.toggle());

    // Close on backdrop click (click outside the panel content)
    this.panel.addEventListener("click", (e) => {
      if (e.target === this.panel) this.close();
    });

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.open) this.close();
    });
  }

  private toggle(): void {
    this.open ? this.close() : this.show();
  }

  private show(): void {
    this.open = true;
    this.panel.classList.add("open");
    this.panel.setAttribute("aria-hidden", "false");
    this.btn.setAttribute("aria-expanded", "true");
    this.btn.classList.add("active");
  }

  private close(): void {
    this.open = false;
    this.panel.classList.remove("open");
    this.panel.setAttribute("aria-hidden", "true");
    this.btn.setAttribute("aria-expanded", "false");
    this.btn.classList.remove("active");
  }
}
