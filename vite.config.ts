import { defineConfig } from "vite";
import legacy from "@vitejs/plugin-legacy";

// The frontend lives in web/. The connector script (connector/fa.mjs) is copied
// verbatim into the build output so the Worker can serve it at /fa.mjs.
export default defineConfig({
  root: "web",
  publicDir: "../connector",
  // Samsung's 2018 Tizen browser is Chromium 56: it cannot run module scripts.
  // A lower build.target alone does not provide a non-module entry point.
  plugins: [legacy({ targets: ["chrome >= 56"], modernPolyfills: true })],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
