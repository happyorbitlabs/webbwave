// Curated map of JWST target names → publicly hosted image URLs
// Sources: ESA/Webb public gallery (esawebb.org) and WebbTelescope.org (STScI)
// Images are freely available for non-commercial use with attribution.

interface JWSTImageEntry {
  keywords: string[]
  url: string
  credit: string
}

const LIBRARY: JWSTImageEntry[] = [
  {
    keywords: ['smacs', '0723', 'smacs0723'],
    // Large JPEG from ESA/Webb CDN — 4.1 MB, high enough resolution for pan/zoom
    url: 'https://cdn.esawebb.org/archives/images/large/webb-first-deep-field.jpg',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['carina', 'cosmic cliffs'],
    url: 'https://stsci-opo.org/STScI-01G7ETPKQ31C56QX5AGA09YBXZ.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ["stephan's quintet", 'stephans quintet', 'stephan quintet'],
    url: 'https://stsci-opo.org/STScI-01G7NKG76Y86HBFC1X60TJK0W0.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['southern ring', 'ngc 3132', 'ngc3132'],
    url: 'https://stsci-opo.org/STScI-01G7ETQB2AX4C57RZNF7F3VQHD.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['pillars of creation', 'eagle nebula', 'm16'],
    url: 'https://stsci-opo.org/STScI-01GK2KFHXE6HBD0VWCQBMW0PXR.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['tarantula', '30 doradus', 'ngc 2070'],
    url: 'https://stsci-opo.org/STScI-01GDS7FP3ATFHBNQ1HG0M41JHF.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['cartwheel galaxy', 'cartwheel'],
    url: 'https://stsci-opo.org/STScI-01G9QNS72S6QH0AVMNR6PBZF97.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['ngc 628', 'ngc628', 'phantom galaxy', 'm74'],
    url: 'https://esawebb.org/media/archives/images/screen/weic2215a.jpg',
    credit: 'ESA/Webb, NASA & CSA, J. Lee and the PHANGS-JWST Team',
  },
  {
    keywords: ['ngc 1365', 'ngc1365'],
    url: 'https://esawebb.org/media/archives/images/screen/weic2302a.jpg',
    credit: 'ESA/Webb, NASA & CSA, L. Armus, A. Evans',
  },
  {
    keywords: ['ngc 346', 'ngc346'],
    url: 'https://stsci-opo.org/STScI-01GS0TKTNZBKZSA1PFX77THQQ4.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['wr 124', 'wolf-rayet 124', 'wolfrayet 124'],
    url: 'https://stsci-opo.org/STScI-01GWZ53PCBTS1BB5GBFJ3GM7N5.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['l1527', 'l 1527'],
    url: 'https://stsci-opo.org/STScI-01GK3E7Z5BRDTRNVQQ30TA5A3H.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['deep field', 'abell 2744'],
    url: 'https://stsci-opo.org/STScI-01GS0M0KKHAFNCB8KY7Y1XC4QB.png',
    credit: 'NASA, ESA, CSA, STScI',
  },
  {
    keywords: ['wr 140', 'wolf-rayet 140'],
    url: 'https://esawebb.org/media/archives/images/screen/weic2218a.jpg',
    credit: 'ESA/Webb, NASA & CSA, R. Lau et al.',
  },
  {
    keywords: ['jupiter'],
    url: 'https://stsci-opo.org/STScI-01GDS6BFBF7VHT3NF4R2FPQKM3.png',
    credit: 'NASA, ESA, CSA, STScI, B. Holler and J. Stansberry',
  },
]

/**
 * Find a JWST image URL for a given target name.
 * Returns null if no match is found.
 */
export function findJWSTImage(targetName: string): string | null {
  const normalized = targetName.toLowerCase().trim()
  for (const entry of LIBRARY) {
    for (const kw of entry.keywords) {
      if (normalized.includes(kw)) return entry.url
    }
  }
  return null
}
