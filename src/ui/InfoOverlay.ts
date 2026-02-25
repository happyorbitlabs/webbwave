import type { ObservationData } from '../data/JWSTFetcher'

export class InfoOverlay {
  private el: HTMLElement
  private coordsEl: HTMLElement | null = null
  private fadeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(container: HTMLElement) {
    this.el = document.createElement('div')
    this.el.id = 'info-overlay'
    container.appendChild(this.el)
  }

  update(obs: ObservationData): void {
    const time = obs.timestamp.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: 'UTC',
    }) + ' UTC'

    this.el.innerHTML = `
      <div class="info-row"><span class="info-label">TARGET</span><span class="info-value">${this.esc(obs.targetName)}</span></div>
      <div class="info-row"><span class="info-label">RA / DEC</span><span class="info-value" id="info-coords">${obs.ra.toFixed(2)}° / ${obs.dec.toFixed(2)}°</span></div>
      <div class="info-row"><span class="info-label">INSTRUMENT</span><span class="info-value">${this.esc(obs.instrument)}</span></div>
      <div class="info-row"><span class="info-label">FILTER</span><span class="info-value">${this.esc(obs.filter)}</span></div>
      <div class="info-row"><span class="info-label">UPDATED</span><span class="info-value info-dim">${time}</span></div>
    `

    this.coordsEl = this.el.querySelector('#info-coords')

    // Fade in fully, then settle to resting opacity after 5s
    this.el.style.opacity = '0.85'
    if (this.fadeTimer) clearTimeout(this.fadeTimer)
    this.fadeTimer = setTimeout(() => {
      this.el.style.opacity = '0.45'
    }, 5000)
  }

  // Lightweight update — only swaps the RA/DEC text, no re-render
  setCoords(ra: number, dec: number): void {
    if (!this.coordsEl) return
    const decSgn = (dec >= 0 ? '+' : '') + dec.toFixed(2)
    this.coordsEl.textContent = `${ra.toFixed(2)}° / ${decSgn}°`
    this.el.style.opacity = '0.85'
  }

  resetCoords(ra: number, dec: number): void {
    if (!this.coordsEl) return
    this.coordsEl.textContent = `${ra.toFixed(2)}° / ${dec.toFixed(2)}°`
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}
