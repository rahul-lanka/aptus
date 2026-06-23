import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/aptus/",
  plugins: [react()],
  optimizeDeps: {
    include: ["pdfjs-dist"],
  },
});
