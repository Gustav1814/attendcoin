import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          ethers: ["ethers"],
          react: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
        },
      },
    },
  },
});
