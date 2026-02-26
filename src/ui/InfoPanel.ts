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
      <div class="ip-body">
        <p class="ip-lead">
          Live ambient synth driven by current JWST observations, refreshed every&nbsp;60&nbsp;seconds.
        </p>

        <div class="ip-section">
          <div class="ip-section-title">CONTROLS</div>
          <div class="ip-row">
            <span class="ip-label">DRAG</span>
            <span class="ip-value">Aim on the canvas to steer timbre/space and scan nearby cached observations + signal tracks.</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SCROLL / PINCH</span>
            <span class="ip-value">Zoom controls harmonic spread and visual scale.</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">CHORD</span>
            <span class="ip-value">Choose a root note and mode (MAJ MIN DOM7 MAJ7 SUS4 MIN7) — all 9 drone oscillators retune smoothly.</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">COLOUR</span>
            <span class="ip-value">Controls synth brightness (filter cutoff/Q), with extra sky-position influence while aiming.</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SPACE</span>
            <span class="ip-value">Controls dry/reverb balance and tail size.</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SCATTER</span>
            <span class="ip-value">6-line granular feedback cloud for shimmer and smear.</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">PULSE</span>
            <span class="ip-value">Slow global swell (LFO rate + depth).</span>
          </div>
          <div class="ip-row">
            <span class="ip-label">SIGNAL</span>
            <span class="ip-value">Real NASA/Chandra recordings under the synth. Auto-crossfades every 30–90 s in live mode; drag-aim switches to manual scan. This slider sets blend level.</span>
          </div>
        </div>

        <div class="ip-section">
          <div class="ip-section-title">LIVE DATA</div>
          <p class="ip-lead">Sources: JWST observation data from MAST/STScI (cached + refreshed every 60 s), plus bundled NASA/Chandra space-audio recordings.</p>
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
