import { describe, expect, it } from "vitest";

import {
  formatActiveContext,
  resolveCompilationContext
} from "../src/core/compilationContext";

const compileCommand = {
  sourceFile: "/project/src/main.S",
  compilerPath: "/toolchain/avr-gcc",
  workingDirectory: "/project",
  mcu: "atmega328p",
  defines: ["PROJECT=1"],
  undefines: ["OLD_PROJECT"],
  includePaths: ["/project/include"]
} as const;

const platformio = {
  environmentName: "customDx",
  compilerPath: "/pio/avr-gcc",
  mcu: "avr128db48",
  defines: ["F_CPU=24000000UL"],
  includePaths: ["/pio/avr/include"]
} as const;

describe("resolveCompilationContext", () => {
  it("prefers an exact compilation command over PlatformIO", () => {
    const context = resolveCompilationContext({ compileCommand, platformio });

    expect(context).toEqual({
      dialect: "gnu-avr",
      source: "compileCommands",
      compilerPath: "/toolchain/avr-gcc",
      mcu: "atmega328p",
      defines: ["PROJECT=1"],
      undefines: ["OLD_PROJECT"],
      includePaths: ["/project/include"],
      workingDirectory: "/project"
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context?.defines)).toBe(true);
  });

  it("allows explicit settings to override lower-priority context", () => {
    expect(resolveCompilationContext({
      configuredCompilerPath: "/custom/avr-gcc",
      configuredMcu: "attiny85",
      compileCommand,
      platformio
    })).toEqual({
      dialect: "gnu-avr",
      source: "manual",
      compilerPath: "/custom/avr-gcc",
      mcu: "attiny85",
      defines: [],
      undefines: [],
      includePaths: []
    });
  });

  it("falls through to generic PlatformIO and INI contexts", () => {
    expect(resolveCompilationContext({ platformio })).toEqual({
      dialect: "gnu-avr",
      source: "platformio",
      compilerPath: "/pio/avr-gcc",
      mcu: "avr128db48",
      defines: ["F_CPU=24000000UL"],
      undefines: [],
      includePaths: ["/pio/avr/include"],
      environmentName: "customDx"
    });
    expect(resolveCompilationContext({ iniMcu: "attiny85" })).toEqual({
      dialect: "gnu-avr",
      source: "platformioIni",
      compilerPath: "avr-gcc",
      mcu: "attiny85",
      defines: [],
      undefines: [],
      includePaths: []
    });
    expect(resolveCompilationContext({})).toBeUndefined();
  });

  it("copies source arrays instead of retaining mutable inputs", () => {
    const defines = ["PROJECT=1"];
    const context = resolveCompilationContext({
      compileCommand: { ...compileCommand, defines }
    });
    defines.push("LATE_MUTATION=1");

    expect(context?.defines).toEqual(["PROJECT=1"]);
  });
});

describe("formatActiveContext", () => {
  it("describes static-only mode when no context is available", () => {
    expect(formatActiveContext(undefined)).toContain("Static completions remain available");
  });

  it("formats the same context used for preprocessing", () => {
    const context = resolveCompilationContext({ compileCommand });

    expect(formatActiveContext(context)).toBe([
      "AVR Assembly active context",
      "Source: compile_commands.json",
      "Dialect: GNU AVR",
      "MCU: atmega328p",
      "Compiler: /toolchain/avr-gcc",
      "Working directory: /project",
      "Defines: 1",
      "Undefines: 1",
      "Include paths: 1"
    ].join("\n"));
  });
});
