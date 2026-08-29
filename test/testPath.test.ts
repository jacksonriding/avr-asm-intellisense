import { describe, expect, it } from "vitest";

import { pathsEqual } from "./extension-host/testPath";

describe("pathsEqual", () => {
  it("treats Windows drive-letter casing as equivalent", () => {
    expect(pathsEqual(
      "D:\\a\\avr-asm-intellisense",
      "d:\\a\\avr-asm-intellisense",
      "win32"
    )).toBe(true);
  });

  it("normalizes Windows separator differences", () => {
    expect(pathsEqual(
      "D:/a/avr-asm-intellisense",
      "d:\\a\\avr-asm-intellisense",
      "win32"
    )).toBe(true);
  });

  it("preserves case sensitivity on POSIX platforms", () => {
    expect(pathsEqual("/tmp/AVR", "/tmp/avr", "linux")).toBe(false);
  });
});
