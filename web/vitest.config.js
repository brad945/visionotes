import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node", // pure-logic tests need no DOM
    include: ["src/**/*.test.{js,jsx}"],
  },
});
