// Vercel Serverless Function (Node.js runtime) — proxies MAST JWST search API
// with a 5-minute in-memory cache so only one request per warm instance hits MAST.
// MAST takes ~90s to respond; the cache means browsers always get a fast response.
//
// Client calls: POST /api/jwst
// Upstream:     POST https://mast.stsci.edu/search/jwst/api/v0.1/search

import type { IncomingMessage, ServerResponse } from 'http'

export const config = { maxDuration: 120 }  // allow up to 120s for the upstream fetch

const MAST_URL  = 'https://mast.stsci.edu/search/jwst/api/v0.1/search'
const CACHE_TTL = 5 * 60 * 1000  // 5 minutes

const MAST_BODY = JSON.stringify({
  limit: 10,
  sort_by: ['date_obs'],
  sort_desc: [true],
  select_cols: ['targprop', 'targ_ra', 'targ_dec', 'instrume', 'opticalElements', 'targtype', 'exp_type'],
  skip_count: true,
})

// Module-level cache — persists across requests on the same warm function instance
let cachedBody: string | null = null
let cacheTime  = 0

export default async function handler(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  // Return cached response if fresh
  if (cachedBody && Date.now() - cacheTime < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT')
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.end(cachedBody)
    return
  }

  try {
    const upstream = await fetch(MAST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: MAST_BODY,
    })

    const body = await upstream.text()
    cachedBody = body
    cacheTime  = Date.now()

    res.setHeader('X-Cache', 'MISS')
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.statusCode = upstream.status
    res.end(body)
  } catch (err) {
    res.statusCode = 502
    res.end(JSON.stringify({ error: String(err) }))
  }
}
