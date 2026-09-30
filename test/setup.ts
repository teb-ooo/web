import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetPlayground } from "../src/testing.js";

afterEach(() => {
  cleanup();
  resetPlayground();
});
