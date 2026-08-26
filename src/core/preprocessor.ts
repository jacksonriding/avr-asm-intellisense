import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { parseObjectMacros } from "./macroParser";
import type { AvrMacro } from "./types";

const MCU_PATTERN = /^[A-Za-z0-9_+-]+$/u;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface PreprocessorRequest {
  readonly compilerPath: string;
  readonly mcu?: string;
  readonly compilerFlags?: readonly string[];
  readonly defines?: readonly string[];
  readonly includePaths?: readonly string[];
  readonly source: string;
  readonly timeoutMs?: number;
}

export type PreprocessorContext = Omit<PreprocessorRequest, "source" | "timeoutMs">;

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

function validateDefine(define: string): string {
  if (define.length > 4_096
    || !/^[A-Za-z_][A-Za-z0-9_]*(?:=.*)?$/su.test(define)
    || /[\0\r\n]/u.test(define)) {
    throw new Error("Invalid AVR preprocessor definition.");
  }
  return define;
}

function validateIncludePath(includePath: string): string {
  if (includePath.length === 0 || includePath.length > 4_096 || /[\0\r\n]/u.test(includePath)) {
    throw new Error("Invalid AVR include path.");
  }
  return includePath;
}

function validateCompilerFlag(flag: string): string {
  if (flag.length === 0 || flag.length > 4_096 || /[\0\r\n]/u.test(flag)) {
    throw new Error("Invalid AVR compiler flag.");
  }
  return flag;
}

function hasMcuFlag(flags: readonly string[]): boolean {
  return flags.some((flag) => flag === "-mmcu" || flag.startsWith("-mmcu="));
}

export function buildPreprocessorArgs(
  context: Pick<PreprocessorContext, "mcu" | "compilerFlags" | "defines" | "includePaths">
): readonly string[] {
  const compilerFlags = [...new Set(context.compilerFlags ?? [])].map(validateCompilerFlag);
  const args: string[] = [...compilerFlags];
  if (!hasMcuFlag(args) && context.mcu !== undefined) {
    args.push(`-mmcu=${validateMcu(context.mcu)}`);
  }
  for (const define of new Set(context.defines ?? [])) {
    args.push(`-D${validateDefine(define)}`);
  }
  for (const includePath of new Set(context.includePaths ?? [])) {
    args.push("-I", validateIncludePath(includePath));
  }
  args.push(
    "-x",
    "assembler-with-cpp",
    "-E",
    "-dM",
    "-"
  );
  return Object.freeze(args);
}

export async function runAvrPreprocessor(
  request: PreprocessorRequest,
  spawnProcess: SpawnProcess = defaultSpawnProcess
): Promise<readonly AvrMacro[]> {
  if (request.compilerPath.length === 0 || request.compilerPath.includes("\0")) {
    throw new Error("Invalid AVR compiler path.");
  }

  const args = buildPreprocessorArgs(request);
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
