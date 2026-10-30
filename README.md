# Webbwave

A generative drone synth in the browser that turns the latest James Webb Space Telescope observations into an ambient soundscape and visuals.

| Status | Platforms | Website |
|---|---|---|
| Live | Web | [webbwave.vercel.app](https://webbwave.vercel.app) |

## Current state

Deployed on Vercel with Vercel Analytics. Built over a few days in late February 2026; the last change (more signal recordings) was in early March 2026 and nothing has happened since.

- A Vercel function (`api/jwst.ts`) proxies the MAST JWST search API with a five-minute cache, and a cron keeps it warm.
- Each observation's coordinates, instrument and target type drive the drone (filter, reverb, LFO rate, voice count) and pick a matching JWST image to pan across.
- A second layer cross-fades between bundled NASA/Chandra sonifications and space recordings (`public/audio/`) chosen by target type.
- Autopilot mode drifts and zooms the view on its own. There are iOS-specific fixes and a headphones tip on iPhone and iPad.

## Development

```sh
npm install
npm run dev
```
