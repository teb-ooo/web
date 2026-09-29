import { defineConfig } from "vitest/config";

const external = [
  /^react($|\/)/,
  /^react-dom($|\/)/,
  /^@tanstack\//,
  /^openapi-fetch($|\/)/,
  /^openapi-react-query($|\/)/,
  /^ajv($|\/)/,
  /^ajv-formats($|\/)/,
  /^msw($|\/)/,
  /^vitest($|\/)/,
  /^@testing-library\//,
];

export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    minify: false,
    lib: {
      entry: { index: "src/index.ts", testing: "src/testing.ts" },
      formats: ["es"],
    },
    rollupOptions: { external },
  },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:3000/" } },
    globals: true,
    include: ["test/**/*.test.{ts,tsx}"],
    typecheck: { enabled: true, include: ["test/**/*.test-d.ts"], tsconfig: "./tsconfig.json" },
    setupFiles: ["test/setup.ts"],
  },
});
