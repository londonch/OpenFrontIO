import {
  type AssetManifest,
  buildAssetUrl,
} from "@openfront/shared/AssetPaths";
import { rewriteAssetsForCdn } from "@openfront/shared/AssetUrls";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import { lookup as lookupMime } from "mrmime";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";
import { configDefaults } from "vitest/config";
import {
  buildPublicAssetManifest,
  copyRootPublicFiles,
  createHashedPublicAssetFiles,
  getProprietaryDir,
  getPublicDir,
  getResourcesDir,
  writePublicAssetManifest,
  writeRootFilesIndex,
} from "./src/server/PublicAssetManifest";

// Vite already handles these, but its good practice to define them explicitly
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dev-only: resources/public/ is served at the site root, as the build copies
// it into static/. Vite's publicDir (resources/) would put it under /public/.
function serveRootPublicDir(publicDir: string): Plugin {
  return {
    name: "serve-root-public-dir",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        let rel = decodeURIComponent(
          new URL(req.url, "http://x").pathname,
        ).replace(/^\/+/, "");
        if (rel.split(/[\\/]/).some((part) => part === "." || part === ".."))
          return next();
        if (rel === "" || rel.endsWith("/")) rel += "index.html";
        const filePath = path.join(publicDir, rel);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
          return next();
        const mime = lookupMime(filePath);
        if (mime) res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

function serveProprietaryDir(
  proprietaryDir: string,
  resourcesDir: string,
): Plugin {
  return {
    name: "serve-proprietary-dir",
    configureServer(server) {
      // Must run before Vite's htmlFallback; skip when resources/ has the file
      // so publicDir keeps precedence.
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const rel = decodeURIComponent(
          new URL(req.url, "http://x").pathname,
        ).replace(/^\//, "");
        if (rel.includes("..")) return next();
        if (fs.existsSync(path.join(resourcesDir, rel))) return next();
        const filePath = path.join(proprietaryDir, rel);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
          return next();
        const mime = lookupMime(filePath);
        if (mime) res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "no-store");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isProduction = mode === "production";
  // Dev identity: the same INSTANCE_LETTER / NUM_WORKERS defaults the dev
  // server boots with (ServerEnv), so the dev-served index.html carries the
  // one-entry map production RenderHtml injects.
  const devInstanceLetter = env.INSTANCE_LETTER || "a";
  // Strict decimal first: Number() alone would take "1e3" or " 2".
  const devNumWorkers = /^[1-9][0-9]*$/.test(env.NUM_WORKERS || "2")
    ? Number(env.NUM_WORKERS || 2)
    : NaN;
  // The same checks ServerEnv applies: the letter leads every game id, and
  // the count feeds a modulo, so a bad value here is a wNaN worker path.
  if (!/^[a-z]$/.test(devInstanceLetter)) {
    throw new Error(
      `INSTANCE_LETTER must be one lowercase letter, got ${JSON.stringify(devInstanceLetter)}`,
    );
  }
  if (!Number.isInteger(devNumWorkers) || devNumWorkers < 1) {
    throw new Error(
      `NUM_WORKERS must be a positive integer, got ${JSON.stringify(env.NUM_WORKERS)}`,
    );
  }
  const devClusterJson = JSON.stringify({
    [devInstanceLetter]: { host: "localhost", numWorkers: devNumWorkers },
  });
  const resourcesDir = getResourcesDir(__dirname);
  const proprietaryDir = getProprietaryDir(__dirname);
  const sourceDirs = [resourcesDir, proprietaryDir];
  const assetManifest: AssetManifest = isProduction
    ? buildPublicAssetManifest(sourceDirs)
    : {};
  const cdnBase = env.CDN_BASE ?? "";
  const htmlAssetData = {
    assetManifest: JSON.stringify(assetManifest),
    cdnBase: JSON.stringify(cdnBase),
    gameEnv: JSON.stringify(env.GAME_ENV ?? "dev"),
    cluster: devClusterJson,
    instanceLetter: JSON.stringify(devInstanceLetter),
    turnstileSiteKey: JSON.stringify(
      env.TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA",
    ),
    jwtAudience: JSON.stringify(env.DOMAIN ?? "localhost"),
    // Dev only: set FARO_COLLECTOR_URL in .env to point a local client at a
    // collector; unset drops the guarded line, exactly as in production.
    faroCollectorUrl: env.FARO_COLLECTOR_URL
      ? JSON.stringify(env.FARO_COLLECTOR_URL)
      : undefined,
    instanceId: JSON.stringify(env.INSTANCE_ID ?? "DEV_ID"),
    manifestHref: buildAssetUrl("manifest.json", assetManifest, cdnBase),
    faviconHref: buildAssetUrl("images/Favicon.svg", assetManifest, cdnBase),
    gameplayScreenshotUrl: buildAssetUrl(
      "images/GameplayScreenshot.png",
      assetManifest,
      cdnBase,
    ),
    backgroundImageUrl: buildAssetUrl(
      "images/background.webp",
      assetManifest,
      cdnBase,
    ),
    desktopLogoImageUrl: buildAssetUrl(
      "images/OpenFront.png",
      assetManifest,
      cdnBase,
    ),
    mobileLogoImageUrl: buildAssetUrl("images/OF.png", assetManifest, cdnBase),
  };

  // Vite's HTML transform replaces the source <script src="/src/client/Main.ts">
  // with the hashed bundle URL and injects <link rel="modulepreload"> /
  // <link rel="stylesheet"> tags. rewriteAssetsForCdn rewrites those refs to
  // an EJS placeholder so RenderHtml.ts can prefix them with CDN_BASE at
  // request time.
  const injectCdnBaseTemplate = (): Plugin => ({
    name: "inject-cdn-base-template",
    apply: "build" as const,
    enforce: "post",
    transformIndexHtml: rewriteAssetsForCdn,
  });

  let viteBundleFiles: string[] = [];
  const syncHashedPublicAssets = (): Plugin => ({
    name: "sync-hashed-public-assets",
    apply: "build" as const,
    writeBundle(_options, bundle) {
      viteBundleFiles = Object.keys(bundle);
    },
    closeBundle() {
      const outDir = path.join(__dirname, "static");
      copyRootPublicFiles(getPublicDir(resourcesDir), outDir);
      writeRootFilesIndex(getPublicDir(resourcesDir), outDir);
      // Run the source→hashed copy first; createHashedPublicAssetFiles iterates
      // assetManifest and expects every key to resolve to a file in resources/
      // or proprietary/. Vite's bundle output (assets/...) doesn't, so it's
      // merged in after.
      createHashedPublicAssetFiles(sourceDirs, outDir, assetManifest);
      // Track Vite's own bundle output (vendor chunks, JS, CSS, workers under
      // static/assets/) in the manifest so the deploy-time R2 upload covers
      // them alongside the hashed source assets. Skip non-assets/ emits like
      // index.html — those are served by the app, not from R2.
      for (const fileName of viteBundleFiles) {
        if (!fileName.startsWith("assets/")) continue;
        assetManifest[fileName] = `/${fileName}`;
      }
      writePublicAssetManifest(outDir, assetManifest);
    },
  });

  return {
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./tests/setup.ts",
      // Node 25 turned Web Storage on by default, where `localStorage` is a
      // built-in global that evaluates to undefined unless --localstorage-file
      // is passed. It shadows the jsdom localStorage vitest installs, so every
      // test touching UserSettings dies on "Cannot read properties of
      // undefined (reading 'getItem')". Turn Node's own Web Storage off in the
      // test workers so jsdom always provides it. No-op on Node 24, which keeps
      // Web Storage behind a flag.
      execArgv: ["--no-experimental-webstorage"],
      // Git worktrees live inside the repo, so their tests match the default
      // glob and run against that worktree's own (often stale) source and
      // node_modules. Anyone with a worktree checked out sees failures that
      // have nothing to do with their branch.
      // Spread the defaults rather than restating them: setting `exclude`
      // replaces vitest's built-in list, and hand-copying a subset silently
      // drops the dot-directory pattern (.git, .cache, .output, ...) --
      // reintroducing the same stray-file problem this is here to fix.
      exclude: [
        ...configDefaults.exclude,
        "**/.worktrees/**",
        "**/.claude/worktrees/**",
      ],
    },
    root: "./",
    base: "/",
    publicDir: isProduction ? false : "resources",

    // Vite's JS preload helper (`__vitePreload`, used by dynamic import())
    // resolves a chunk's dependency list against `base`, so with base "/" the
    // helper chunks behind e.g. the lazy Faro import were requested from the
    // page origin, where nothing serves /assets/ (openfront.io answered 503,
    // and the import() rejected, so telemetry never started). Emitting those
    // references relative makes the helper resolve them against
    // import.meta.url, i.e. wherever the importing chunk itself was loaded
    // from -- the CDN in production, same-origin in dev -- without baking
    // CDN_BASE into the bundle (the Docker build does not have it). HTML keeps
    // Vite's /assets/ refs so rewriteAssetsForCdn can turn them into the
    // request-time EJS placeholder.
    experimental: {
      renderBuiltUrl(_filename, { hostType }) {
        if (hostType === "js") return { relative: true };
        return undefined;
      },
    },

    resolve: {
      tsconfigPaths: true,
      alias: {
        resources: path.resolve(__dirname, "resources"),
      },
    },

    plugins: [
      ...(!isProduction
        ? [
            serveRootPublicDir(getPublicDir(resourcesDir)),
            serveProprietaryDir(proprietaryDir, resourcesDir),
          ]
        : []),
      ...(isProduction
        ? []
        : [
            createHtmlPlugin({
              minify: false,
              entry: "/src/client/Main.ts",
              template: "index.html",
              inject: {
                data: {
                  gitCommit: JSON.stringify("DEV"),
                  ...htmlAssetData,
                },
              },
            }),
          ]),
      ...(isProduction
        ? [injectCdnBaseTemplate(), syncHashedPublicAssets()]
        : []),
      tailwindcss(),
    ],

    define: {
      __ASSET_MANIFEST__: JSON.stringify(assetManifest),
      "process.env.WEBSOCKET_URL": JSON.stringify(
        isProduction ? "" : "localhost:3000",
      ),
      "process.env.GAME_ENV": JSON.stringify(isProduction ? "prod" : "dev"),
      // Force empty under vitest (mode "test") so the getApiBase localhost-
      // fallback test is deterministic regardless of any API_DOMAIN in the
      // host shell / CI environment.
      "process.env.API_DOMAIN": JSON.stringify(
        mode === "test" ? "" : (env.API_DOMAIN ?? ""),
      ),
      // Add other process.env variables if needed, OR migrate code to import.meta.env
    },

    build: {
      outDir: "static", // Webpack outputs to 'static', assuming we want to keep this.
      emptyOutDir: true,
      assetsDir: "assets", // Sub-directory for assets
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            const vendorModules = ["howler", "zod"];
            if (vendorModules.some((module) => id.includes(module))) {
              return "vendor";
            }
          },
        },
      },
    },

    server: {
      port: 9000,
      host: process.env.VITE_HOST === "lan",
      // Automatically open the browser when the server starts
      open: process.env.SKIP_BROWSER_OPEN !== "true",
      // This build is solo only: the game runs in the browser against a local
      // stand-in server (LocalServer), so there is no game server to proxy.
    },
  };
});
