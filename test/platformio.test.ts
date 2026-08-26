import { describe, expect, it } from "vitest";

import { parsePlatformioConfig, selectPlatformioMcu } from "../src/core/platformio";

describe("parsePlatformioConfig", () => {
  it("parses default environments and board_build.mcu values", () => {
    const config = parsePlatformioConfig([
      "[platformio]",
      "default_envs = uno, nano",
      "",
      "[env:uno]",
      "board = uno",
      "board_build.mcu = atmega328p",
      "",
      "[env:nano]",
      "board_build.mcu = atmega328pb ; inline note"
    ].join("\n"));

    expect(config).toEqual({
      defaultEnvironmentNames: ["uno", "nano"],
      environments: [
        { name: "uno", mcu: "atmega328p" },
        { name: "nano", mcu: "atmega328pb" }
      ]
    });
  });

  it("ignores comments, malformed lines, and non-environment sections", () => {
    expect(parsePlatformioConfig([
      "; comment",
      "# another comment",
      "[common]",
      "board_build.mcu = ignored",
      "not an assignment",
      "[env:custom]",
      "board_build.f_cpu = 16000000L"
    ].join("\n"))).toEqual({
      defaultEnvironmentNames: [],
      environments: []
    });
  });
});

describe("selectPlatformioMcu", () => {
  it("prefers the requested environment when one is configured", () => {
    const config = parsePlatformioConfig([
      "[platformio]",
      "default_envs = uno",
      "[env:uno]",
      "board_build.mcu = atmega328p",
      "[env:mega]",
      "board_build.mcu = atmega2560"
    ].join("\n"));

    expect(selectPlatformioMcu(config, "mega")).toBe("atmega2560");
  });

  it("uses the first default environment with an MCU", () => {
    const config = parsePlatformioConfig([
      "[platformio]",
      "default_envs = missing mega",
      "[env:mega]",
      "board_build.mcu = atmega2560"
    ].join("\n"));

    expect(selectPlatformioMcu(config)).toBe("atmega2560");
  });

  it("falls back to the first environment when default_envs is omitted", () => {
    const config = parsePlatformioConfig([
      "[env:standalone]",
      "board_build.mcu = attiny85"
    ].join("\n"));

    expect(selectPlatformioMcu(config)).toBe("attiny85");
  });

  it("inherits the MCU declared in the shared env section", () => {
    const config = parsePlatformioConfig([
      "[platformio]",
      "default_envs = uno",
      "[env]",
      "board_build.mcu = atmega328p",
      "[env:uno]",
      "board = uno"
    ].join("\n"));

    expect(selectPlatformioMcu(config)).toBe("atmega328p");
  });
});
