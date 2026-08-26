import { describe, expect, it } from "vitest";

import { resolveAvrToolchain } from "../src/core/toolchainContext";

const metadata = {
  environmentName: "QUTy",
  compilerPath: "/pio/avr-gcc",
  mcu: "attiny1626",
  defines: ["__AVR_DEV_LIB_NAME__=tn1626"],
  includePaths: ["/pio/avr/include"]
} as const;

describe("resolveAvrToolchain", () => {
  it("resolves QUTy entirely from generic PlatformIO metadata", () => {
    expect(resolveAvrToolchain({ metadata })).toEqual({
      compilerPath: "/pio/avr-gcc",
      mcu: "attiny1626",
      defines: ["__AVR_DEV_LIB_NAME__=tn1626"],
      includePaths: ["/pio/avr/include"]
    });
  });

  it("applies explicit settings before metadata and INI fallback", () => {
    expect(resolveAvrToolchain({
      configuredCompilerPath: "/custom/avr-gcc",
      configuredMcu: "atmega328p",
      metadata,
      iniMcu: "attiny85"
    })).toEqual({
      compilerPath: "/custom/avr-gcc",
      mcu: "atmega328p",
      defines: [],
      includePaths: []
    });
  });

  it("preserves generic non-PlatformIO fallback", () => {
    expect(resolveAvrToolchain({ iniMcu: "attiny85" })).toEqual({
      compilerPath: "avr-gcc",
      mcu: "attiny85",
      defines: [],
      includePaths: []
    });
    expect(resolveAvrToolchain({})).toBeUndefined();
  });
});
