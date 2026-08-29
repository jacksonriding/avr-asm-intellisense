import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  parsePlatformioMetadata,
  runPlatformioMetadata,
  selectPlatformioContext,
  type MetadataSpawnProcess
} from "../src/core/platformioMetadata";

interface FakeChild {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
}

function createFakeChild(onStart?: (process: FakeChild) => void): FakeChild {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = vi.fn();
  const stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const child = Object.assign(emitter, { stdin, stdout, stderr, kill });
  const process = { child: child as ChildProcessWithoutNullStreams, stdout, stderr, kill };
  queueMicrotask(() => onStart?.(process));
  return process;
}

const qutyMetadata = JSON.stringify({
  QUTy: {
    env_name: "QUTy",
    cc_path: "/pio/packages/toolchain-atmelavr/bin/avr-gcc",
    cc_flags: ["-Os", "-mmcu=attiny1626", "-fdata-sections"],
    defines: [
      "F_CPU=3333333L",
      "__AVR_DEV_LIB_NAME__=tn1626",
      "PLATFORMIO=60119"
    ],
    includes: {
      build: ["/project/include", "/project/src"],
      compatlib: ["/project/include"],
      toolchain: ["/pio/packages/toolchain-atmelavr/avr/include"]
    },
    extra: { ignored: true }
  }
});

describe("parsePlatformioMetadata", () => {
  it("normalizes QUTy through generic AVR metadata", () => {
    const contexts = parsePlatformioMetadata(qutyMetadata);

    expect(contexts).toEqual([{
      environmentName: "QUTy",
      compilerPath: "/pio/packages/toolchain-atmelavr/bin/avr-gcc",
      mcu: "attiny1626",
      defines: ["F_CPU=3333333L", "__AVR_DEV_LIB_NAME__=tn1626", "PLATFORMIO=60119"],
      includePaths: [
        "/project/include",
        "/project/src",
        "/pio/packages/toolchain-atmelavr/avr/include"
      ]
    }]);
    expect(Object.isFrozen(contexts)).toBe(true);
    expect(Object.isFrozen(contexts[0]?.defines)).toBe(true);
  });

  it("ignores unusable environments and rejects malformed JSON", () => {
    expect(parsePlatformioMetadata(JSON.stringify({
      arm: { cc_path: "/usr/bin/arm-gcc", cc_flags: "-mcpu=cortex-m0" },
      broken: { cc_path: 42, cc_flags: "-mmcu=atmega328p" }
    }))).toEqual([]);
    expect(() => parsePlatformioMetadata("not json")).toThrow("Invalid PlatformIO metadata JSON.");
    expect(() => parsePlatformioMetadata("[]")).toThrow("Invalid PlatformIO metadata document.");
  });

  it("accepts legacy string compiler flags", () => {
    const contexts = parsePlatformioMetadata(JSON.stringify({
      legacy: {
        cc_path: "/pio/avr-gcc",
        cc_flags: "-Os -mmcu=attiny85 -DLEGACY_CORE=1"
      }
    }));

    expect(contexts[0]).toMatchObject({
      mcu: "attiny85",
      defines: ["LEGACY_CORE=1"]
    });
  });
});

describe("selectPlatformioContext", () => {
  const contexts = parsePlatformioMetadata(JSON.stringify({
    uno: {
      cc_path: "/pio/avr-gcc",
      cc_flags: "-mmcu=atmega328p",
      defines: [],
      includes: {}
    },
    QUTy: JSON.parse(qutyMetadata).QUTy
  }));

  it("uses explicit environment, then defaults, then the first AVR context", () => {
    expect(selectPlatformioContext(contexts, "QUTy")?.mcu).toBe("attiny1626");
    expect(selectPlatformioContext(contexts, "", ["uno"])?.mcu).toBe("atmega328p");
    expect(selectPlatformioContext(contexts)?.environmentName).toBe("uno");
  });

  it("does not silently substitute a missing requested environment", () => {
    expect(selectPlatformioContext(contexts, "missing")).toBeUndefined();
  });
});

describe("runPlatformioMetadata", () => {
  it("runs PlatformIO without a shell and parses its output", async () => {
    const process = createFakeChild((current) => {
      current.stdout.write(qutyMetadata);
      current.child.emit("close", 0);
    });
    const spawnProcess: MetadataSpawnProcess = vi.fn(() => process.child);

    const contexts = await runPlatformioMetadata({
      executablePath: "pio",
      projectDir: "/project path",
      environmentName: "QUTy"
    }, spawnProcess);

    expect(contexts[0]?.mcu).toBe("attiny1626");
    expect(spawnProcess).toHaveBeenCalledWith("pio", [
      "project", "metadata", "--json-output", "--project-dir", "/project path",
      "--environment", "QUTy"
    ], {
      cwd: "/project path",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
  });

  it("bounds failures and timeouts", async () => {
    const failed = createFakeChild((current) => {
      current.stderr.write("metadata unavailable");
      current.child.emit("close", 1);
    });
    await expect(runPlatformioMetadata({
      executablePath: "pio",
      projectDir: "/project"
    }, vi.fn(() => failed.child))).rejects.toThrow("PlatformIO metadata failed: metadata unavailable");

    const stalled = createFakeChild();
    await expect(runPlatformioMetadata({
      executablePath: "pio",
      projectDir: "/project",
      timeoutMs: 1
    }, vi.fn(() => stalled.child))).rejects.toThrow("PlatformIO metadata timed out.");
    expect(stalled.kill).toHaveBeenCalledOnce();

    const noisy = createFakeChild((current) => {
      current.stdout.write(Buffer.alloc(4 * 1024 * 1024 + 1));
    });
    await expect(runPlatformioMetadata({
      executablePath: "pio",
      projectDir: "/project"
    }, vi.fn(() => noisy.child))).rejects.toThrow(
      "PlatformIO metadata output exceeded the safety limit."
    );
    expect(noisy.kill).toHaveBeenCalledOnce();
  });

  it("cancels active metadata discovery and kills PlatformIO", async () => {
    const controller = new AbortController();
    const process = createFakeChild();
    const pending = runPlatformioMetadata({
      executablePath: "pio",
      projectDir: "/project",
      signal: controller.signal
    }, vi.fn(() => process.child));

    controller.abort();
    process.child.emit("close", 0);

    await expect(pending).rejects.toThrow("PlatformIO metadata was cancelled.");
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("validates executable, project, and environment inputs", async () => {
    const spawnProcess = vi.fn();
    await expect(runPlatformioMetadata({ executablePath: "", projectDir: "/project" }, spawnProcess))
      .rejects.toThrow("Invalid PlatformIO executable path.");
    await expect(runPlatformioMetadata({ executablePath: "pio", projectDir: "" }, spawnProcess))
      .rejects.toThrow("Invalid PlatformIO project directory.");
    await expect(runPlatformioMetadata({
      executablePath: "pio",
      projectDir: "/project",
      environmentName: "bad\nenv"
    }, spawnProcess)).rejects.toThrow("Invalid PlatformIO environment name.");
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
