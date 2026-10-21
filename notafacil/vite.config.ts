import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const paginas = mode === "pages";
  return {
    plugins: [react()],
    root: path.resolve(raiz, "src/web"),
    base: paginas ? "./" : "/",
    build: {
      outDir: paginas ? path.resolve(raiz, "../app") : path.resolve(raiz, "dist/client"),
      emptyOutDir: true,
    },
  };
});
