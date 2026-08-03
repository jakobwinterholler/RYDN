import { writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

function companionVersionManifest(): Plugin {
  const manifest = {
    version: pkg.version,
    builtAt: new Date().toISOString(),
  };
  return {
    name: "companion-version-manifest",
    configureServer(server) {
      server.middlewares.use("/version.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.end(JSON.stringify(manifest));
      });
    },
    writeBundle(options) {
      const outDir = options.dir ?? "dist";
      writeFileSync(
        path.join(outDir, "version.json"),
        JSON.stringify({
          version: pkg.version,
          builtAt: new Date().toISOString(),
        }),
      );
    },
  };
}

export default defineConfig({
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  plugins: [
    react(),
    companionVersionManifest(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "auto",
      includeAssets: [
        "favicon.svg",
        "apple-touch-icon.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
      ],
      manifest: {
        id: "/",
        name: "Race Companion",
        short_name: "Companion",
        description: "Offline race resupply companion for ultra rides",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        file_handlers: [
          {
            action: "/",
            accept: {
              "application/gpx+xml": [".gpx"],
              "application/xml": [".gpx"],
              "text/xml": [".gpx"],
              "application/octet-stream": [".gpx"],
            },
          },
        ],
        share_target: {
          action: "/?import=gpx",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            files: [
              {
                name: "gpx",
                accept: [".gpx", "application/gpx+xml", "application/xml", "text/xml"],
              },
            ],
          },
        },
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        importScripts: ["/share-import-sw.js"],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webmanifest}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        skipWaiting: false,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: {
                maxEntries: 1500,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5175,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
