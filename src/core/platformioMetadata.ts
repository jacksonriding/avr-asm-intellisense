import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const ENVIRONMENT_PATTERN = /^[A-Za-z0-9_.-]+$/u;
const DEFINE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:=.*)?$/su;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_VALUE_LENGTH = 4_096;

export interface PlatformioCompilationContext {
  readonly environmentName: string;
  readonly compilerPath: string;
  readonly mcu: string;
  readonly defines: readonly string[];
  readonly includePaths: readonly string[];
}

export interface PlatformioMetadataRequest {
  readonly executablePath: string;
  readonly projectDir: string;
  readonly environmentName?: string;
  readonly timeoutMs?: number;
}

interface MetadataProcessOptions {
  readonly cwd: string;
  readonly shell: false;
  readonly stdio: readonly ["pipe", "pipe", "pipe"];
}

export type MetadataSpawnProcess = (
  executable: string,
  args: readonly string[],
  options: MetadataProcessOptions
) => ChildProcessWithoutNullStreams;

const defaultSpawnProcess: MetadataSpawnProcess = (executable, args, options) =>
  spawn(executable, [...args], {
    cwd: options.cwd,
    shell: options.shell,
    stdio: [...options.stdio]
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_VALUE_LENGTH
    && !/[\0\r\n]/u.test(value);
}

function normalizeCompilerFlags(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return Object.freeze(value.split(/\s+/u).filter((flag) => flag.length > 0));
  }
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }
  return Object.freeze(value.filter(validText));
}

function findMcu(compilerFlags: readonly string[]): string | undefined {
  for (let index = 0; index < compilerFlags.length; index += 1) {
    const flag = compilerFlags[index];
    if (flag?.startsWith("-mmcu=")) {
      const mcu = flag.slice("-mmcu=".length);
      return /^[A-Za-z0-9_+-]+$/u.test(mcu) ? mcu : undefined;
    }
    if (flag === "-mmcu") {
      const mcu = compilerFlags[index + 1];
      return mcu !== undefined && /^[A-Za-z0-9_+-]+$/u.test(mcu) ? mcu : undefined;
    }
  }
  return undefined;
}

function collectDefines(
  metadata: Record<string, unknown>,
  compilerFlags: readonly string[]
): readonly string[] {
  const defines = new Set<string>();
  if (Array.isArray(metadata.defines)) {
    for (const define of metadata.defines) {
      if (validText(define) && DEFINE_PATTERN.test(define)) {
        defines.add(define);
      }
    }
  }
  for (const flag of compilerFlags) {
    const define = flag.startsWith("-D") ? flag.slice(2) : undefined;
    if (define !== undefined && validText(define) && DEFINE_PATTERN.test(define)) {
      defines.add(define);
    }
  }
  return Object.freeze([...defines]);
}

function collectIncludePaths(metadata: Record<string, unknown>): readonly string[] {
  if (!isRecord(metadata.includes)) {
    return Object.freeze([]);
  }
  const includePaths = new Set<string>();
  for (const group of Object.values(metadata.includes)) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const includePath of group) {
      if (validText(includePath)) {
        includePaths.add(includePath);
      }
    }
  }
  return Object.freeze([...includePaths]);
}

export function parsePlatformioMetadata(output: string): readonly PlatformioCompilationContext[] {
  let document: unknown;
  try {
    document = JSON.parse(output);
  } catch {
    throw new Error("Invalid PlatformIO metadata JSON.");
  }
  if (!isRecord(document)) {
    throw new Error("Invalid PlatformIO metadata document.");
  }

  const contexts: PlatformioCompilationContext[] = [];
  for (const [key, value] of Object.entries(document)) {
    if (!isRecord(value) || !validText(value.cc_path)) {
      continue;
    }
    const compilerFlags = normalizeCompilerFlags(value.cc_flags);
    const mcu = findMcu(compilerFlags);
    if (mcu === undefined) {
      continue;
    }
    const environmentName = validText(value.env_name) ? value.env_name : key;
    if (!ENVIRONMENT_PATTERN.test(environmentName)) {
      continue;
    }
    contexts.push(Object.freeze({
      environmentName,
      compilerPath: value.cc_path,
      mcu,
      defines: collectDefines(value, compilerFlags),
      includePaths: collectIncludePaths(value)
    }));
  }
  return Object.freeze(contexts);
}

export function selectPlatformioContext(
  contexts: readonly PlatformioCompilationContext[],
  requestedEnvironment = "",
  defaultEnvironmentNames: readonly string[] = []
): PlatformioCompilationContext | undefined {
  const byName = new Map(contexts.map((context) => [context.environmentName, context]));
  if (requestedEnvironment.trim().length > 0) {
    return byName.get(requestedEnvironment.trim());
  }
  for (const environmentName of defaultEnvironmentNames) {
    const context = byName.get(environmentName);
    if (context !== undefined) {
      return context;
    }
  }
  return contexts[0];
}

export async function runPlatformioMetadata(
  request: PlatformioMetadataRequest,
  spawnProcess: MetadataSpawnProcess = defaultSpawnProcess
): Promise<readonly PlatformioCompilationContext[]> {
  if (!validText(request.executablePath)) {
    throw new Error("Invalid PlatformIO executable path.");
  }
  if (!validText(request.projectDir)) {
    throw new Error("Invalid PlatformIO project directory.");
  }
  if (request.environmentName !== undefined
    && request.environmentName.length > 0
    && !ENVIRONMENT_PATTERN.test(request.environmentName)) {
    throw new Error("Invalid PlatformIO environment name.");
  }

  const args = [
    "project", "metadata", "--json-output", "--project-dir", request.projectDir
  ];
  if (request.environmentName !== undefined && request.environmentName.length > 0) {
    args.push("--environment", request.environmentName);
  }
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return await new Promise((resolve, reject) => {
    const child = spawnProcess(request.executablePath, args, {
      cwd: request.projectDir,
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
        finish(() => reject(new Error("PlatformIO metadata output exceeded the safety limit.")));
        return;
      }
      target.push(chunk);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("PlatformIO metadata timed out.")));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.on("error", () => {
      finish(() => reject(new Error("Unable to start the configured PlatformIO executable.")));
    });
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString("utf8").trim().slice(0, 500);
          reject(new Error(detail.length > 0
            ? `PlatformIO metadata failed: ${detail}`
            : "PlatformIO metadata failed."));
          return;
        }
        try {
          resolve(parsePlatformioMetadata(Buffer.concat(stdout).toString("utf8")));
        } catch (error: unknown) {
          reject(error);
        }
      });
    });
    child.stdin.end();
  });
}
