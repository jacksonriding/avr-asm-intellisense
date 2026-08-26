import { describe, expect, it } from "vitest";

import {
  findCompilationCommand,
  parseCompilationDatabase
} from "../src/core/compileCommands";

describe("parseCompilationDatabase", () => {
  it("extracts an immutable AVR context from an arguments entry", () => {
    const contexts = parseCompilationDatabase(JSON.stringify([{
      directory: "/project",
      file: "src/main.S",
      arguments: [
        "toolchains/avr-gcc",
        "-mmcu=attiny1626",
        "-D__AVR_DEV_LIB_NAME__=tn1626",
        "-Iinclude",
        "-isystem", "vendor/include",
        "-c", "src/main.S",
        "-o", "main.o"
      ]
    }]));

    expect(contexts).toEqual([{
      sourceFile: "/project/src/main.S",
      compilerPath: "/project/toolchains/avr-gcc",
      workingDirectory: "/project",
      mcu: "attiny1626",
      defines: ["__AVR_DEV_LIB_NAME__=tn1626"],
      undefines: [],
      includePaths: ["/project/include", "/project/vendor/include"]
    }]);
    expect(Object.isFrozen(contexts)).toBe(true);
    expect(Object.isFrozen(contexts[0])).toBe(true);
    expect(Object.isFrozen(contexts[0]?.defines)).toBe(true);
  });

  it("tokenizes quoted command entries without executing a shell", () => {
    const contexts = parseCompilationDatabase(JSON.stringify([{
      directory: "/project with spaces",
      file: "source/main.S",
      command: "'/opt/avr toolchain/bin/avr-gcc' -mmcu atmega328p '-DNAME=hello world' -I 'include dir' -c source/main.S"
    }]));

    expect(contexts[0]).toEqual({
      sourceFile: "/project with spaces/source/main.S",
      compilerPath: "/opt/avr toolchain/bin/avr-gcc",
      workingDirectory: "/project with spaces",
      mcu: "atmega328p",
      defines: ["NAME=hello world"],
      undefines: [],
      includePaths: ["/project with spaces/include dir"]
    });
  });

  it("selects only the exact document entry", () => {
    const contexts = parseCompilationDatabase(JSON.stringify([
      {
        directory: "/project",
        file: "src/first.S",
        arguments: ["avr-gcc", "-mmcu=atmega328p", "-c", "src/first.S"]
      },
      {
        directory: "/project",
        file: "src/second.S",
        arguments: ["avr-gcc", "-mmcu=attiny85", "-c", "src/second.S"]
      }
    ]));

    expect(findCompilationCommand(contexts, "/project/src/second.S")?.mcu).toBe("attiny85");
    expect(findCompilationCommand(contexts, "/project/src/missing.S")).toBeUndefined();
  });

  it("ignores unsafe or unusable entries without interpreting their flags", () => {
    const contexts = parseCompilationDatabase(JSON.stringify([
      {
        directory: "/project",
        file: "src/response.S",
        arguments: ["avr-gcc", "@untrusted.rsp", "-mmcu=atmega328p"]
      },
      {
        directory: "/project",
        file: "src/plugin.S",
        arguments: ["avr-gcc", "-fplugin=/tmp/plugin.so", "-mmcu=atmega328p"]
      },
      {
        directory: "/project",
        file: "src/no-mcu.S",
        arguments: ["avr-gcc", "-c", "src/no-mcu.S"]
      }
    ]));

    expect(contexts).toEqual([]);
  });

  it("rejects malformed and oversized database input with stable errors", () => {
    expect(() => parseCompilationDatabase("{}"))
      .toThrow("Compilation database must be a JSON array.");
    expect(() => parseCompilationDatabase("not json"))
      .toThrow("Invalid compilation database JSON.");
    expect(() => parseCompilationDatabase(" ".repeat(8 * 1024 * 1024 + 1)))
      .toThrow("Compilation database exceeds the safety limit.");
  });
});
