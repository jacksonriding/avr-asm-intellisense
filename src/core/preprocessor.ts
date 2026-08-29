import { parseObjectMacros } from "./macroParser";
import {
  ProcessExecutionError,
  runBoundedProcess,
  type SpawnProcess
} from "./processRunner";
import type { AvrMacro } from "./types";

const MCU_PATTERN = /^[A-Za-z0-9_+-]+$/u;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface PreprocessorRequest {
  readonly compilerPath: string;
  readonly mcu?: string;
  readonly defines?: readonly string[];
  readonly undefines?: readonly string[];
  readonly includePaths?: readonly string[];
  readonly source: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type PreprocessorContext = Omit<PreprocessorRequest, "signal" | "source" | "timeoutMs">;
export type { SpawnProcess } from "./processRunner";

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

function validateUndefine(undefine: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(undefine)) {
    throw new Error("Invalid AVR preprocessor undefinition.");
  }
  return undefine;
}

export function buildPreprocessorArgs(
  context: Pick<PreprocessorContext, "mcu" | "defines" | "undefines" | "includePaths">
): readonly string[] {
  const args: string[] = [];
  if (context.mcu !== undefined) {
    args.push(`-mmcu=${validateMcu(context.mcu)}`);
  }
  for (const define of new Set(context.defines ?? [])) {
    args.push(`-D${validateDefine(define)}`);
  }
  for (const undefine of new Set(context.undefines ?? [])) {
    args.push(`-U${validateUndefine(undefine)}`);
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
  spawnProcess?: SpawnProcess
): Promise<readonly AvrMacro[]> {
  if (request.compilerPath.length === 0 || request.compilerPath.includes("\0")) {
    throw new Error("Invalid AVR compiler path.");
  }

  const args = buildPreprocessorArgs(request);
  let result;
  try {
    result = await runBoundedProcess({
      executable: request.compilerPath,
      args,
      input: request.source,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      ...(request.signal === undefined ? {} : { signal: request.signal })
    }, spawnProcess);
  } catch (error: unknown) {
    if (error instanceof ProcessExecutionError) {
      const message = error.reason === "aborted" ? "AVR preprocessing was cancelled."
        : (error.reason === "timeout" ? "AVR preprocessor timed out."
          : (error.reason === "outputLimit"
            ? "AVR preprocessor output exceeded the safety limit."
            : "Unable to start the configured AVR compiler."));
      throw new Error(message);
    }
    throw error;
  }

  if (result.exitCode !== 0) {
    const detail = result.stderr.trim().slice(0, 500);
    throw new Error(detail.length > 0
      ? `AVR preprocessing failed: ${detail}`
      : "AVR preprocessing failed.");
  }
  return parseObjectMacros(result.stdout);
}
