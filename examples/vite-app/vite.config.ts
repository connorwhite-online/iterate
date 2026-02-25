import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { iterate } from "@iterate/vite";

export default defineConfig({
  plugins: [react(), iterate()],
  server: {
    // iterate sets PORT env var for each worktree's dev server
    port: parseInt(process.env.PORT ?? "5173"),
    strictPort: true,
  },
});
