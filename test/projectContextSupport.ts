import { vi } from "vitest";

import type {
  ProjectContextConfiguration,
  ProjectContextDependencies,
  ProjectContextDiagnostic,
  ProjectContextOptions,
  ResolveProjectContextRequest
} from "../src/core/projectContext";
import type {
  PlatformioCompilationContext,
  PlatformioMetadataRequest
} from "../src/core/platformioMetadata";

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return Object.freeze({
    promise,
    resolve: (value: T) => resolvePromise?.(value),
    reject: (error: unknown) => rejectPromise?.(error)
  });
}

export const defaultConfiguration: ProjectContextConfiguration = Object.freeze({
  compilerPath: "",
  mcu: "",
  compileCommandsPath: "",
  platformioEnvironment: "",
  platformioExecutable: "pio",
  usePlatformioMetadata: true
});

export function contextRequest(
  options: Readonly<{
    documentPath?: string;
    workspaceRoot?: string;
    workspaceKey?: string;
    configuration?: Partial<ProjectContextConfiguration>;
    signal?: AbortSignal;
  }> = {}
): ResolveProjectContextRequest {
  const workspaceRoot = options.workspaceRoot ?? "/workspace";
  return Object.freeze({
    documentPath: options.documentPath ?? `${workspaceRoot}/src/main.S`,
    workspace: Object.freeze({
      rootPath: workspaceRoot,
      cacheKey: options.workspaceKey ?? `file://${workspaceRoot}`
    }),
    configuration: Object.freeze({
      ...defaultConfiguration,
      ...options.configuration
    }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
}

export function manualRequest(
  configuration: Partial<ProjectContextConfiguration> = {}
): ResolveProjectContextRequest {
  return Object.freeze({
    documentPath: "untitled:main.S",
    configuration: Object.freeze({
      ...defaultConfiguration,
      compilerPath: "/tools/avr-gcc",
      mcu: "atmega328p",
      ...configuration
    })
  });
}

export function compileCommands(
  workspaceRoot = "/workspace",
  mcu = "atmega328p"
): string {
  return JSON.stringify([{
    directory: workspaceRoot,
    file: "src/main.S",
    arguments: ["/tools/avr-gcc", `-mmcu=${mcu}`, "-DPROJECT=1", "-c", "src/main.S"]
  }]);
}

export function metadataContext(
  mcu = "atmega328p",
  environmentName = "test"
): PlatformioCompilationContext {
  return Object.freeze({
    environmentName,
    compilerPath: "/pio/avr-gcc",
    mcu,
    defines: Object.freeze(["PLATFORMIO=1"]),
    includePaths: Object.freeze(["/pio/include"])
  });
}

export function serviceHarness(options: ProjectContextOptions = {}): Readonly<{
  dependencies: ProjectContextDependencies;
  readTextFile: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>;
  runMetadata: ReturnType<typeof vi.fn<(
    request: PlatformioMetadataRequest
  ) => Promise<readonly PlatformioCompilationContext[]>>>;
  report: ReturnType<typeof vi.fn<(diagnostic: ProjectContextDiagnostic) => void>>;
  setNow(value: number): void;
  readonly options: ProjectContextOptions;
}> {
  let now = 1_000;
  const readTextFile = vi.fn<(path: string) => Promise<string>>();
  const runMetadata = vi.fn<(
    request: PlatformioMetadataRequest
  ) => Promise<readonly PlatformioCompilationContext[]>>();
  const report = vi.fn<(diagnostic: ProjectContextDiagnostic) => void>();
  return Object.freeze({
    dependencies: Object.freeze({
      readTextFile,
      runMetadata,
      report,
      now: () => now
    }),
    readTextFile,
    runMetadata,
    report,
    setNow: (value: number) => { now = value; },
    options
  });
}
