import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react({ jsxRuntime: "classic" }), tailwindcss()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/main.tsx"),
      formats: ["iife"],
      name: "MujicaStudio",
      fileName: () => "studio.js",
      cssFileName: "studio",
    },
    rollupOptions: {
      output: {
        entryFileNames: "assets/studio.js",
        assetFileNames: (asset) => asset.names.includes("studio.css")
          ? "assets/studio.css"
          : "assets/[name][extname]",
      },
    },
  },
});
