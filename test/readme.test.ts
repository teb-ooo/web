import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pkg from "../src/index.js";

const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");

describe("README", () => {
  it("names every value exported to apps", () => {
    const missing = Object.keys(pkg).filter((name) => !new RegExp(`\\b${name}\\b`).test(readme));
    expect(missing, `exported but not in the README: ${missing.join(", ")}`).toEqual([]);
  });
  it("does not show the app calling the shell's feedback pieces", () => {
    expect(readme).not.toMatch(/useFeedbackCommand|<FeedbackPanel|<LiveIndicator/);
  });
});
