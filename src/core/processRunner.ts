import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type ProcessFailureReason = "aborted" | "outputLimit" | "startup" | "timeout";

export class ProcessExecutionError extends Error {
  readonly reason: ProcessFailureReason;

  constructor(reason: ProcessFailureReason) {
    super(`Process execution failed: ${reason}.`);
    this.name = "ProcessExecutionError";
    this.reason = reason;
  }
}

interface ProcessSpawnOptions {
  readonly cwd?: string;
  readonly shell: false;
  readonly stdio: readonly ["pipe", "pipe", "pipe"];
}

export type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: ProcessSpawnOptions
) => ChildProcessWithoutNullStreams;

const defaultSpawnProcess: SpawnProcess = (executable, args, options) =>
  spawn(executable, [...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    shell: options.shell,
    stdio: [...options.stdio]
  });

export interface BoundedProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly input: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runBoundedProcess(
  request: BoundedProcessRequest,
  spawnProcess: SpawnProcess = defaultSpawnProcess
): Promise<ProcessResult> {
  if (request.signal?.aborted === true) {
    throw new ProcessExecutionError("aborted");
  }

  const spawnOptions: ProcessSpawnOptions = request.cwd === undefined
    ? Object.freeze({ shell: false, stdio: ["pipe", "pipe", "pipe"] as const })
    : Object.freeze({ cwd: request.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] as const });
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnProcess(request.executable, request.args, spawnOptions);
  } catch {
    throw new ProcessExecutionError("startup");
  }

  return await new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let killAttempted = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      request.signal?.removeEventListener("abort", abort);
      callback();
    };
    const fail = (reason: ProcessFailureReason, kill: boolean): void => {
      if (settled) {
        return;
      }
      if (kill && !killAttempted) {
        killAttempted = true;
        try {
          child.kill();
        } catch {
          // The process may already have exited; the original bounded failure remains authoritative.
        }
      }
      finish(() => reject(new ProcessExecutionError(reason)));
    };
    const abort = (): void => fail("aborted", true);
    const collect = (target: Buffer[], chunk: Buffer): void => {
      if (settled) {
        return;
      }
      outputBytes += chunk.byteLength;
      if (outputBytes > request.maxOutputBytes) {
        fail("outputLimit", true);
        return;
      }
      target.push(Buffer.from(chunk));
    };

    timer = setTimeout(() => fail("timeout", true), request.timeoutMs);
    request.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.stdin.on("error", () => {
      // Early child exit commonly closes stdin first; close code, stderr, or timeout is authoritative.
    });
    child.on("error", () => fail("startup", false));
    child.on("close", (code) => {
      finish(() => resolve(Object.freeze({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      })));
    });

    if (request.signal?.aborted === true) {
      abort();
      return;
    }
    try {
      child.stdin.end(request.input);
    } catch {
      // A synchronous close races the same child close/timeout handlers used for stream errors.
    }
  });
}
