import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  buildPreprocessorArgs,
  runAvrPreprocessor,
  validateMcu,
  type SpawnProcess
} from "../src/core/preprocessor";

interface FakeChild {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
}

function createFakeChild(onInput?: (source: string, process: FakeChild) => void): FakeChild {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks: Buffer[] = [];
  const kill = vi.fn();
  let process: FakeChild;
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
    final(callback) {
      callback();
      queueMicrotask(() => onInput?.(Buffer.concat(chunks).toString("utf8"), process));
    }
  });
  const child = Object.assign(emitter, { stdin, stdout, stderr, kill });
  process = { child: child as ChildProcessWithoutNullStreams, stdout, stderr, kill };
  return process;
}

function spawnReturning(process: FakeChild): SpawnProcess {
  return vi.fn(() => process.child);
}

describe("validateMcu", () => {
  it("accepts conventional AVR MCU identifiers", () => {
    expect(validateMcu("atmega328p")).toBe("atmega328p");
    expect(validateMcu("ATtiny3217")).toBe("ATtiny3217");
  });

  it.each(["", "atmega328p;touch", "../../compiler", "atmega 328p", "a\nb"])(
    "rejects unsafe MCU input %j",
    (mcu) => expect(() => validateMcu(mcu)).toThrow("Invalid AVR MCU")
  );
});

describe("buildPreprocessorArgs", () => {
  it("builds a shell-free stdin preprocessing invocation", () => {
    expect(buildPreprocessorArgs({ mcu: "atmega328p" })).toEqual([
      "-mmcu=atmega328p",
      "-x",
      "assembler-with-cpp",
      "-E",
      "-dM",
      "-"
    ]);
  });

  it("passes only validated metadata defines and include paths", () => {
    expect(buildPreprocessorArgs({
      mcu: "attiny1626",
      defines: ["__AVR_DEV_LIB_NAME__=tn1626", "F_CPU=3333333L"],
      undefines: ["LEGACY_DEVICE"],
      includePaths: ["/path with spaces/include"]
    })).toEqual([
      "-mmcu=attiny1626",
      "-D__AVR_DEV_LIB_NAME__=tn1626",
      "-DF_CPU=3333333L",
      "-ULEGACY_DEVICE",
      "-I",
      "/path with spaces/include",
      "-x",
      "assembler-with-cpp",
      "-E",
      "-dM",
      "-"
    ]);
  });
});

describe("runAvrPreprocessor", () => {
  it("invokes the compiler without a shell and parses stdout", async () => {
    const process = createFakeChild((source, current) => {
      expect(source).toContain("#include <avr/io.h>");
      current.stdout.write("#define PORTB _SFR_IO8(0x05)\n");
      current.child.emit("close", 0);
    });
    const spawnProcess = spawnReturning(process);

    await expect(runAvrPreprocessor({
      compilerPath: "/toolchain path/avr-gcc",
      mcu: "atmega328p",
      source: "#include <avr/io.h>\n"
    }, spawnProcess)).resolves.toEqual([
      { name: "PORTB", expansion: "_SFR_IO8(0x05)" }
    ]);
    expect(spawnProcess).toHaveBeenCalledWith(
      "/toolchain path/avr-gcc",
      buildPreprocessorArgs({ mcu: "atmega328p" }),
      { shell: false, stdio: ["pipe", "pipe", "pipe"] }
    );
  });

  it("returns a bounded compiler error for a nonzero exit", async () => {
    const process = createFakeChild((_source, current) => {
      current.stderr.write("bad MCU configuration");
      current.child.emit("close", 1);
    });

    await expect(runAvrPreprocessor({
      compilerPath: "avr-gcc",
      mcu: "atmega328p",
      source: ""
    }, spawnReturning(process))).rejects.toThrow("AVR preprocessing failed: bad MCU configuration");
  });

  it("handles process startup errors without leaking system details", async () => {
    const process = createFakeChild((_source, current) => {
      current.child.emit("error", new Error("secret environment details"));
    });

    await expect(runAvrPreprocessor({
      compilerPath: "missing-avr-gcc",
      mcu: "atmega328p",
      source: ""
    }, spawnReturning(process))).rejects.toThrow("Unable to start the configured AVR compiler.");
  });

  it("enforces timeout and output limits", async () => {
    const stalled = createFakeChild();
    await expect(runAvrPreprocessor({
      compilerPath: "avr-gcc",
      mcu: "atmega328p",
      source: "",
      timeoutMs: 1
    }, spawnReturning(stalled))).rejects.toThrow("AVR preprocessor timed out.");
    expect(stalled.kill).toHaveBeenCalledOnce();

    const noisy = createFakeChild((_source, current) => {
      current.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1));
    });
    await expect(runAvrPreprocessor({
      compilerPath: "avr-gcc",
      mcu: "atmega328p",
      source: ""
    }, spawnReturning(noisy))).rejects.toThrow("AVR preprocessor output exceeded the safety limit.");
    expect(noisy.kill).toHaveBeenCalledOnce();
  });

  it("rejects an invalid compiler path before spawning", async () => {
    const spawnProcess = vi.fn();
    await expect(runAvrPreprocessor({
      compilerPath: "",
      mcu: "atmega328p",
      source: ""
    }, spawnProcess)).rejects.toThrow("Invalid AVR compiler path.");
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
