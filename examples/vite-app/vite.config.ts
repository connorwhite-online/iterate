import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // iterate sets PORT env var for each worktree's dev server
    port: parseInt(process.env.PORT ?? "5173"),
    strictPort: true,
  },
});
