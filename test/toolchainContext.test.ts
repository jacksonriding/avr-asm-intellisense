import { describe, expect, it } from "vitest";

import { resolveAvrToolchain } from "../src/core/toolchainContext";

const metadata = {
  environmentName: "customDx",
  compilerPath: "/pio/avr-gcc",
  mcu: "avr128db48",
  defines: ["F_CPU=24000000UL"],
  includePaths: ["/pio/avr/include"]
} as const;

describe("resolveAvrToolchain", () => {
  it("resolves toolchains entirely from generic PlatformIO metadata", () => {
    expect(resolveAvrToolchain({ metadata })).toEqual({
      compilerPath: "/pio/avr-gcc",
      mcu: "avr128db48",
      defines: ["F_CPU=24000000UL"],
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
