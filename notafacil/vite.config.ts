import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve("src/web"),
  build: {
    outDir: path.resolve("dist/client"),
    emptyOutDir: true,
  },
});
