/// <reference types="vitest/config" />
import { defineConfig, type Plugin, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { networkInterfaces } from "node:os";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number(process.env.PORT_FE || 5180);

function lanIp(): string | null {
  for (const iface of Object.values(networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

function isHttpsPublicHost(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return false;
  return true;
}

/** Print Desktop + public URLs from env (no hardcoded domains). */
function printUrls(publicUrl: string): Plugin {
  return {
    name: "ultra-print-urls",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const ip = lanIp();
        const addr = server.httpServer?.address();
        const port = typeof addr === "object" && addr ? addr.port : PORT;
        setTimeout(() => {
          const line = "\n  \x1b[1mUltra\x1b[0m — local ready\n";
          const desktop = `  Local:    \x1b[36mhttp://localhost:${port}\x1b[0m`;
          const pub = `  Public:   \x1b[36m${publicUrl}\x1b[0m`;
          const phone = ip
            ? `  LAN:      \x1b[36mhttp://${ip}:${port}\x1b[0m  (use ${publicUrl} for OAuth)`
            : `  LAN:      (no Wi-Fi IP)`;
          server.config.logger.info(`${line}${desktop}\n${pub}\n${phone}\n`);
        }, 80);
      });
    },
  };
}

/** Stamp a unique cache version into sw.js on every production build. */
function stampServiceWorker(): Plugin {
  return {
    name: "rydn-stamp-sw",
    apply: "build",
    closeBundle() {
      const swPath = resolve(__dirname, "dist/sw.js");
      try {
        const raw = readFileSync(swPath, "utf8");
        const version = createHash("sha256")
          .update(String(Date.now()) + raw)
          .digest("hex")
          .slice(0, 12);
        writeFileSync(swPath, raw.replace(/__RYDN_SW_VERSION__/g, version), "utf8");
      } catch {
        /* sw missing — ignore */
      }
    },
  };
}

/** Ensure index.html / sw.js are never cached stale across deploys. */
function noCacheHtml(): Plugin {
  return {
    name: "rydn-no-cache-html",
    transformIndexHtml(html) {
      if (html.includes('http-equiv="Cache-Control"')) return html;
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />\n    <meta http-equiv="Pragma" content="no-cache" />`,
      );
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (url === "/" || url.startsWith("/index.html") || (!url.includes(".") && !url.startsWith("/api"))) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (url.startsWith("/assets/")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (url.startsWith("/sw.js")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
        next();
      });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url || "").startsWith("/sw.js")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const publicUrl = (env.VITE_PUBLIC_URL || process.env.PUBLIC_URL || "http://localhost:5180").replace(
    /\/$/,
    "",
  );
  const apiTarget = `http://127.0.0.1:${env.PORT_BE || process.env.PORT_BE || 8100}`;

  return {
    plugins: [react(), printUrls(publicUrl), stampServiceWorker(), noCacheHtml()],
    build: {
      target: "es2020",
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
          },
        },
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
    server: {
      port: PORT,
      host: "0.0.0.0",
      strictPort: true,
      allowedHosts: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: false,
          configure(proxy) {
            proxy.on("proxyReq", (proxyReq, req) => {
              const host = req.headers.host;
              if (host) proxyReq.setHeader("X-Forwarded-Host", String(host));
              const xfProto = req.headers["x-forwarded-proto"];
              const proto =
                (Array.isArray(xfProto) ? xfProto[0] : xfProto) ||
                (isHttpsPublicHost(typeof host === "string" ? host : undefined) ? "https" : "http");
              proxyReq.setHeader("X-Forwarded-Proto", String(proto));
            });
          },
        },
      },
    },
  };
});
