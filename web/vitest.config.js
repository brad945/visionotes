import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // the hero harness renders real components, so JSX has to be transformed
  plugins: [react()],
  test: {
    // Most tests are pure logic and need no DOM. The hero harness mounts the
    // real component to step its draw loop deterministically; those files opt
    // into jsdom with a `@vitest-environment jsdom` docblock.
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
  },
});
