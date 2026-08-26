import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { parseObjectMacros } from "./macroParser";
import type { AvrMacro } from "./types";

const MCU_PATTERN = /^[A-Za-z0-9_+-]+$/u;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface PreprocessorRequest {
  readonly compilerPath: string;
  readonly mcu: string;
  readonly source: string;
  readonly timeoutMs?: number;
}

export type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: Readonly<{ shell: false; stdio: readonly ["pipe", "pipe", "pipe"] }>
) => ChildProcessWithoutNullStreams;

const defaultSpawnProcess: SpawnProcess = (executable, args, options) =>
  spawn(executable, [...args], {
    shell: options.shell,
    stdio: [...options.stdio]
  });

export function validateMcu(mcu: string): string {
  if (!MCU_PATTERN.test(mcu)) {
    throw new Error("Invalid AVR MCU identifier.");
  }
  return mcu;
}

export function buildPreprocessorArgs(mcu: string): readonly string[] {
  return Object.freeze([
    `-mmcu=${validateMcu(mcu)}`,
    "-x",
    "assembler-with-cpp",
    "-E",
    "-dM",
    "-"
  ]);
}

export async function runAvrPreprocessor(
  request: PreprocessorRequest,
  spawnProcess: SpawnProcess = defaultSpawnProcess
): Promise<readonly AvrMacro[]> {
  if (request.compilerPath.length === 0 || request.compilerPath.includes("\0")) {
    throw new Error("Invalid AVR compiler path.");
  }

  const args = buildPreprocessorArgs(request.mcu);
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise((resolve, reject) => {
    const child = spawnProcess(request.compilerPath, args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const collect = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        finish(() => reject(new Error("AVR preprocessor output exceeded the safety limit.")));
        return;
      }
      target.push(chunk);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("AVR preprocessor timed out.")));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", () => {
      finish(() => reject(new Error("Unable to start the configured AVR compiler.")));
    });
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").trim().slice(0, 500);
          reject(new Error(detail.length > 0 ? `AVR preprocessing failed: ${detail}` : "AVR preprocessing failed."));
          return;
        }
        resolve(parseObjectMacros(Buffer.concat(stdout).toString("utf8")));
      });
    });

    child.stdin.end(request.source);
  });
}
