import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetFactory } from "../src/testing.js";

afterEach(() => {
  cleanup();
  resetFactory();
});
