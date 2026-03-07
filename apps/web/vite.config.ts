import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "http://localhost:20005";
  const srcPath = fileURLToPath(new URL("./src", import.meta.url));

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": srcPath,
      },
    },
    server: {
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (currentPath) => currentPath.replace(/^\/api/, ""),
        },
      },
    },
  };
});
