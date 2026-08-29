import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  ProcessExecutionError,
  runBoundedProcess,
  type SpawnProcess
} from "../src/core/processRunner";

interface FakeChild {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: ReturnType<typeof vi.fn>;
  readonly input: () => string;
}

function createFakeChild(): FakeChild {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks: Buffer[] = [];
  const kill = vi.fn();
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  const child = Object.assign(emitter, { stdin, stdout, stderr, kill });
  return {
    child: child as ChildProcessWithoutNullStreams,
    stdout,
    stderr,
    kill,
    input: () => Buffer.concat(chunks).toString("utf8")
  };
}

function spawnReturning(process: FakeChild): SpawnProcess {
  return vi.fn(() => process.child);
}

describe("runBoundedProcess", () => {
  it("uses the default shell-free Node process implementation", async () => {
    const result = await runBoundedProcess({
      executable: process.execPath,
      args: ["--version"],
      input: "",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    });

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toMatch(/^v\d+/u);
  });

  it("captures bounded output and writes input without a shell", async () => {
    const process = createFakeChild();
    const spawnProcess = spawnReturning(process);
    const pending = runBoundedProcess({
      executable: "/tool path/program",
      args: ["--value", "argument with spaces"],
      input: "source input",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    }, spawnProcess);

    process.stdout.write("standard output");
    process.stderr.write("standard error");
    process.child.emit("close", 0);

    await expect(pending).resolves.toEqual({
      exitCode: 0,
      stdout: "standard output",
      stderr: "standard error"
    });
    expect(Object.isFrozen(await pending)).toBe(true);
    expect(process.input()).toBe("source input");
    expect(spawnProcess).toHaveBeenCalledWith(
      "/tool path/program",
      ["--value", "argument with spaces"],
      { shell: false, stdio: ["pipe", "pipe", "pipe"] }
    );
  });

  it("does not spawn when the request is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const spawnProcess = vi.fn();

    await expect(runBoundedProcess({
      executable: "program",
      args: [],
      input: "",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      signal: controller.signal
    }, spawnProcess)).rejects.toMatchObject({ reason: "aborted" });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("kills an active child on cancellation and settles only once", async () => {
    const controller = new AbortController();
    const process = createFakeChild();
    const pending = runBoundedProcess({
      executable: "program",
      args: [],
      input: "",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      signal: controller.signal
    }, spawnReturning(process));

    controller.abort();
    process.stdout.write("late output");
    process.child.emit("error", new Error("late error"));
    process.child.emit("close", 0);

    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("cancels when the signal aborts during process startup", async () => {
    const controller = new AbortController();
    const process = createFakeChild();
    const spawnProcess: SpawnProcess = vi.fn(() => {
      controller.abort();
      return process.child;
    });

    await expect(runBoundedProcess({
      executable: "program",
      args: [],
      input: "",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      signal: controller.signal
    }, spawnProcess)).rejects.toMatchObject({ reason: "aborted" });
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("does not kill a process that completed before cancellation", async () => {
    const controller = new AbortController();
    const process = createFakeChild();
    const pending = runBoundedProcess({
      executable: "program",
      args: [],
      input: "",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      signal: controller.signal
    }, spawnReturning(process));

    process.child.emit("close", 0);
    controller.abort();

    await expect(pending).resolves.toMatchObject({ exitCode: 0 });
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("still settles cancellation when killing the child throws", async () => {
    const controller = new AbortController();
    const process = createFakeChild();
    process.kill.mockImplementation(() => {
      throw new Error("operating-system kill failure");
    });
    const pending = runBoundedProcess({
      executable: "program",
      args: [],
      input: "",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024,
      signal: controller.signal
    }, spawnReturning(process));

    controller.abort();

    await expect(pending).rejects.toMatchObject({ reason: "aborted" });
    expect(process.kill).toHaveBeenCalledOnce();
  });

  it("distinguishes startup, timeout, and output-limit failures", async () => {
    const startup = createFakeChild();
    const startupPending = runBoundedProcess({
      executable: "missing",
      args: [],
      input: "",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    }, spawnReturning(startup));
    startup.child.emit("error", new Error("private operating-system detail"));
    await expect(startupPending).rejects.toEqual(
      expect.objectContaining<Partial<ProcessExecutionError>>({ reason: "startup" })
    );

    await expect(runBoundedProcess({
      executable: "missing",
      args: [],
      input: "",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    }, vi.fn(() => {
      throw new Error("private synchronous detail");
    }))).rejects.toEqual(
      expect.objectContaining<Partial<ProcessExecutionError>>({ reason: "startup" })
    );

    const stalled = createFakeChild();
    await expect(runBoundedProcess({
      executable: "slow",
      args: [],
      input: "",
      timeoutMs: 1,
      maxOutputBytes: 1_024
    }, spawnReturning(stalled))).rejects.toMatchObject({ reason: "timeout" });
    expect(stalled.kill).toHaveBeenCalledOnce();

    const noisy = createFakeChild();
    const noisyPending = runBoundedProcess({
      executable: "noisy",
      args: [],
      input: "",
      timeoutMs: 1_000,
      maxOutputBytes: 4
    }, spawnReturning(noisy));
    noisy.stdout.write("12345");
    await expect(noisyPending).rejects.toMatchObject({ reason: "outputLimit" });
    expect(noisy.kill).toHaveBeenCalledOnce();
  });

  it("bounds child stdin errors instead of leaving an unhandled stream error", async () => {
    const process = createFakeChild();
    const pending = runBoundedProcess({
      executable: "early-exit",
      args: [],
      input: "source",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    }, spawnReturning(process));

    process.child.stdin.emit("error", new Error("EPIPE with private detail"));
    process.child.emit("close", 1);

    await expect(pending).resolves.toMatchObject({ exitCode: 1 });
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("bounds synchronous stdin close failures", async () => {
    const process = createFakeChild();
    vi.spyOn(process.child.stdin, "end").mockImplementation(() => {
      throw new Error("synchronous private stream detail");
    });
    const pending = runBoundedProcess({
      executable: "early-exit",
      args: [],
      input: "source",
      timeoutMs: 1_000,
      maxOutputBytes: 1_024
    }, spawnReturning(process));

    process.child.emit("close", 1);

    await expect(pending).resolves.toMatchObject({ exitCode: 1 });
  });
});
