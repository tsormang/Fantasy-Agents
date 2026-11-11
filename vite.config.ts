import { defineConfig } from "vite";

// The frontend lives in web/. The connector script (connector/fa.mjs) is copied
// verbatim into the build output so the Worker can serve it at /fa.mjs.
export default defineConfig({
  root: "web",
  publicDir: "../connector",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: ["es2017", "chrome61", "safari11"],
  },
});
