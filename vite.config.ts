import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/crates/**",
        "**/work/**",
        "**/release/**",
      ],
    },
  },
  build: { target: "es2022" },
});
