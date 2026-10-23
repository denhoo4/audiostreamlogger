import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.ts so the production build's type-check is not
// affected by vitest's bundled Vite typings.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Report-only coverage (no failing threshold yet): CI surfaces the baseline
    // so a threshold can be chosen later. See docs/TESTING.md.
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
