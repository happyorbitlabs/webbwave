export class InfoPanel {
  private panel: HTMLElement;
  private btn: HTMLElement;
  private open = false;

  constructor(appEl: HTMLElement) {
    // ── Toggle button ─────────────────────────────────────────────────────────
    this.btn = document.createElement("button");
    this.btn.id = "info-btn";
    this.btn.textContent = "?";
    this.btn.setAttribute("aria-label", "About Webbwave");
    this.btn.setAttribute("aria-expanded", "false");
    appEl.appendChild(this.btn);

    // ── Panel ─────────────────────────────────────────────────────────────────
    this.panel = document.createElement("div");
    this.panel.id = "info-panel";
    this.panel.setAttribute("aria-hidden", "true");
    this.panel.innerHTML = `
      <div class="ip-header">
        <span class="ip-title">Webbwave</span>
        <button class="ip-close" aria-label="Close">✕</button>
      </div>

      <div class="ip-body">
        <p class="ip-lead">
          A live ambient soundscape driven by the James Webb Space Telescope's
          actual observation schedule — updated every&nbsp;60&nbsp;seconds.
        </p>

        <div class="ip-section">
          <div class="ip-section-title">WHAT YOU'RE HEARING</div>
          <div class="ip-row">
            <span class="ip-label">DRONE</span>
            <span class="ip-value">Fixed chord A1 / E2 / A2 / C♯3 — the telescope's "voice" never changes pitch</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">COLOUR</span>
            <span class="ip-value">Filter timbral brightness — mapped from the telescope's optical filter wavelength</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SPACE</span>
            <span class="ip-value">Reverb depth — mapped from the filter wavelength; longer IR wavelengths feel more distant</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SHIMMER</span>
            <span class="ip-value">Granular cloud — 6-voice feedback delay network simulating grain scatter</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">HARMONICS</span>
            <span class="ip-value">Voice count — expands as you zoom out; collapses to a single fundamental when zoomed in</span>
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
            <span class="ip-value">Colour temperature from the active optical filter — UV/blue short wavelengths to deep red IR long wavelengths</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">DETAIL</span>
            <span class="ip-value">Instrument drives rendering style — NIRCam adds galaxy core highlights; NIRSpec adds spectral streaks; MIRI adds thermal bloom halos</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">LAYOUT</span>
            <span class="ip-value">Seeded from RA / Dec — the same sky coordinates always produce the same scene</span>
          </div>
        </div>

        <div class="ip-section">
          <div class="ip-section-title">LIVE DATA</div>
          <div class="ip-row">
            <span class="ip-label">SOURCE</span>
            <span class="ip-value">jwstapi.com — public API of Webb's observation schedule</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">FIELDS</span>
            <span class="ip-value">Target name, RA / Dec, instrument, optical filter, target type — polled every 60 seconds</span>
          </div>
        </div>

        <div class="ip-section">
          <div class="ip-section-title">CONTROLS</div>
          <div class="ip-row">
            <span class="ip-label">DRAG</span>
            <span class="ip-value">Aim anywhere on the canvas to synthesise a custom sky position — timbre and visuals update in real time</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SCROLL / PINCH</span>
            <span class="ip-value">Zoom in to isolate fundamental frequencies; zoom out to open the full harmonic spectrum</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SLIDERS</span>
            <span class="ip-value">VOLUME · SPACE · COLOUR · SCATTER · PULSE — each controls a bundle of audio parameters simultaneously</span>
          </div>
        </div>
      </div>
    `;
    appEl.appendChild(this.panel);

    // ── Event wiring ─────────────────────────────────────────────────────────
    this.btn.addEventListener("click", () => this.toggle());
    this.panel
      .querySelector(".ip-close")!
      .addEventListener("click", () => this.close());

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
