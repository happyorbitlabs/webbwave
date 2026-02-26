import { defineConfig, type Plugin } from "vite";

const MAST_URL = "https://mast.stsci.edu/search/jwst/api/v0.1/search";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAST_BODY = JSON.stringify({
  limit: 10,
  sort_by: ["date_obs"],
  sort_desc: [true],
  select_cols: [
    "targprop",
    "targ_ra",
    "targ_dec",
    "instrume",
    "opticalElements",
    "targtype",
    "exp_type",
  ],
  skip_count: true,
});
const FALLBACK_BODY = JSON.stringify({
  results: [
    {
      targprop: "SMACS 0723",
      targ_ra: 110.84,
      targ_dec: -73.45,
      instrume: "NIRCam",
      opticalElements: "F277W",
      targtype: "galaxy cluster",
      exp_type: "SCIENCE",
    },
  ],
});

let cachedBody: string | null = null;
let cacheTime = 0;

function devJwstApiPlugin(): Plugin {
  return {
    name: "dev-jwst-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/jwst", async (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "public, max-age=300");

        if (cachedBody && Date.now() - cacheTime < CACHE_TTL_MS) {
          res.setHeader("X-Cache", "HIT");
          res.end(cachedBody);
          return;
        }

        try {
          const upstream = await fetch(MAST_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: MAST_BODY,
            signal: AbortSignal.timeout(25_000),
          });
          const body = await upstream.text();
          if (upstream.ok) {
            cachedBody = body;
            cacheTime = Date.now();
            res.statusCode = 200;
            res.setHeader("X-Cache", "MISS");
            res.end(body);
            return;
          }
          if (cachedBody) {
            res.statusCode = 200;
            res.setHeader("X-Cache", "STALE");
            res.end(cachedBody);
            return;
          }
          res.statusCode = 200;
          res.setHeader("X-Cache", "FALLBACK");
          res.end(FALLBACK_BODY);
        } catch (err) {
          if (cachedBody) {
            res.statusCode = 200;
            res.setHeader("X-Cache", "STALE");
            res.end(cachedBody);
            return;
          }
          res.statusCode = 200;
          res.setHeader("X-Cache", "FALLBACK");
          res.end(FALLBACK_BODY);
        }
      });
    },
  };
}

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    target: "es2020",
  },
  plugins: [devJwstApiPlugin()],
});
