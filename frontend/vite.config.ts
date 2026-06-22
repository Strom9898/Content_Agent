import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    allowedHosts: [
      'deflation-jingle-grudging.ngrok-free.dev',  // 你的 ngrok 域名
      '.ngrok-free.dev',  // 或者允许所有 ngrok 域名
    ],
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});

