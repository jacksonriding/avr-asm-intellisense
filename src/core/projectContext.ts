import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import {
  findCompilationCommand,
  parseCompilationDatabase,
  type CompileCommandContext
} from "./compileCommands";
import {
  resolveCompilationContext,
  type CompilationContext
} from "./compilationContext";
import { parsePlatformioConfig, selectPlatformioMcu } from "./platformio";
import {
  selectPlatformioContext,
  type PlatformioCompilationContext,
  type PlatformioMetadataRequest
} from "./platformioMetadata";

const DEFAULT_METADATA_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 16;

export interface ProjectContextConfiguration {
  readonly compilerPath: string;
  readonly mcu: string;
  readonly compileCommandsPath: string;
  readonly platformioEnvironment: string;
  readonly platformioExecutable: string;
  readonly usePlatformioMetadata: boolean;
}

export interface ProjectContextWorkspace {
  readonly rootPath: string;
  readonly cacheKey: string;
}

export interface ResolveProjectContextRequest {
  readonly documentPath: string;
  readonly workspace?: ProjectContextWorkspace;
  readonly configuration: ProjectContextConfiguration;
  readonly signal?: AbortSignal;
}

export interface ProjectContextDiagnostic {
  readonly category: "compileCommands" | "platformio";
  readonly key: string;
  readonly message: string;
  readonly error?: unknown;
}

export interface ProjectContextDependencies {
  readonly readTextFile: (path: string) => Promise<string>;
  readonly runMetadata: (
    request: PlatformioMetadataRequest
  ) => Promise<readonly PlatformioCompilationContext[]>;
  readonly report: (diagnostic: ProjectContextDiagnostic) => void;
  readonly now: () => number;
}

export interface ProjectContextOptions {
  readonly metadataTtlMs?: number;
  readonly maxEntries?: number;
}

interface CompilationDatabaseResult {
  readonly contexts?: readonly CompileCommandContext[];
  readonly error?: unknown;
}

interface MetadataResult {
  readonly contexts?: readonly PlatformioCompilationContext[];
  readonly error?: unknown;
}

interface TextReadResult {
  readonly content?: string;
  readonly error?: unknown;
}

interface MetadataCacheEntry {
  readonly expiresAt: number;
  readonly contexts: readonly PlatformioCompilationContext[];
}

interface PendingMetadataEntry {
  readonly controller: AbortController;
  readonly generation: number;
  readonly result: Promise<MetadataResult>;
  readonly waiters: Set<symbol>;
}

interface AwaitedResult<T> {
  readonly aborted: boolean;
  readonly value?: T;
}

interface SelectedMetadata {
  readonly aborted: boolean;
  readonly context?: PlatformioCompilationContext;
}

interface MetadataSelection {
  readonly key: string;
  readonly requestedEnvironment: string;
  readonly defaultEnvironmentNames: readonly string[];
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }
  return value;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function lruGet<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

function lruSet<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number,
  onEvict?: (entry: V) => void
): void {
  cache.delete(key);
  while (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value as K | undefined;
    if (oldestKey === undefined) {
      break;
    }
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (oldest !== undefined) {
      onEvict?.(oldest);
    }
  }
  cache.set(key, value);
}

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined
): Promise<AwaitedResult<T>> {
  if (signal === undefined) {
    return Object.freeze({ aborted: false, value: await promise });
  }
  if (signal.aborted) {
    return Object.freeze({ aborted: true });
  }
  let cancel: (() => void) | undefined;
  try {
    return await Promise.race([
      promise.then((value) => Object.freeze({ aborted: false, value })),
      new Promise<AwaitedResult<T>>((resolveCancellation) => {
        cancel = () => resolveCancellation(Object.freeze({ aborted: true }));
        signal.addEventListener("abort", cancel, { once: true });
      })
    ]);
  } finally {
    if (cancel !== undefined) {
      signal.removeEventListener("abort", cancel);
    }
  }
}

function compilationDatabasePaths(
  workspaceRoot: string,
  configuredPath: string
): readonly string[] {
  const selectedPath = configuredPath.trim();
  if (selectedPath.length > 0) {
    return Object.freeze([
      isAbsolute(selectedPath) ? selectedPath : resolve(workspaceRoot, selectedPath)
    ]);
  }
  return Object.freeze([
    resolve(workspaceRoot, "compile_commands.json"),
    resolve(workspaceRoot, "build", "compile_commands.json")
  ]);
}

export class ProjectContextService {
  private readonly metadataTtlMs: number;
  private readonly maxEntries: number;
  private readonly compilationDatabases = new Map<string, Promise<CompilationDatabaseResult>>();
  private readonly metadata = new Map<string, MetadataCacheEntry>();
  private readonly pendingMetadata = new Map<string, PendingMetadataEntry>();
  private readonly reportedDiagnostics = new Map<string, true>();
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly dependencies: ProjectContextDependencies,
    options: ProjectContextOptions = {}
  ) {
    this.metadataTtlMs = nonNegativeFinite(
      options.metadataTtlMs ?? DEFAULT_METADATA_TTL_MS,
      "metadataTtlMs"
    );
    this.maxEntries = positiveInteger(options.maxEntries ?? DEFAULT_MAX_ENTRIES, "maxEntries");
  }

  async resolve(
    request: ResolveProjectContextRequest
  ): Promise<CompilationContext | undefined> {
    if (this.disposed || request.signal?.aborted === true) {
      return undefined;
    }
    const generation = this.generation;
    const configuration = request.configuration;
    const configuredCompilerPath = configuration.compilerPath;
    const configuredMcu = configuration.mcu;
    const workspace = request.workspace;
    if (workspace === undefined) {
      return resolveCompilationContext({ configuredCompilerPath, configuredMcu });
    }

    const compileCommand = await this.findCompileCommand(request, generation);
    if (!this.isCurrent(generation, request.signal)) {
      return undefined;
    }
    if (compileCommand !== undefined) {
      return resolveCompilationContext({
        configuredCompilerPath,
        configuredMcu,
        compileCommand
      });
    }

    const iniPath = resolve(workspace.rootPath, "platformio.ini");
    const iniRead = await awaitWithSignal(
      Promise.resolve()
        .then(async () => await this.dependencies.readTextFile(iniPath))
        .then(
          (content): TextReadResult => Object.freeze({ content }),
          (error: unknown): TextReadResult => Object.freeze({ error })
        ),
      request.signal
    );
    if (iniRead.aborted || !this.isCurrent(generation, request.signal)) {
      return undefined;
    }
    if (iniRead.value?.content === undefined) {
      return resolveCompilationContext({ configuredCompilerPath, configuredMcu });
    }

    const iniContent = iniRead.value.content;
    const iniConfig = parsePlatformioConfig(iniContent);
    const requestedEnvironment = configuration.platformioEnvironment.trim();
    const iniMcu = selectPlatformioMcu(iniConfig, requestedEnvironment);
    let metadata: SelectedMetadata = Object.freeze({ aborted: false });
    if (configuration.usePlatformioMetadata) {
      metadata = await this.resolveMetadata(
        request,
        generation,
        iniContent,
        iniConfig.defaultEnvironmentNames
      );
    }
    if (metadata.aborted || !this.isCurrent(generation, request.signal)) {
      return undefined;
    }

    return resolveCompilationContext({
      configuredCompilerPath,
      configuredMcu,
      ...(metadata.context === undefined ? {} : { platformio: metadata.context }),
      ...(iniMcu === undefined ? {} : { iniMcu })
    });
  }

  clear(): void {
    if (this.disposed) {
      return;
    }
    this.clearState();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.clearState();
    this.disposed = true;
  }

  private clearState(): void {
    this.generation += 1;
    for (const entry of this.pendingMetadata.values()) {
      entry.controller.abort();
    }
    this.compilationDatabases.clear();
    this.metadata.clear();
    this.pendingMetadata.clear();
    this.reportedDiagnostics.clear();
  }

  private isCurrent(generation: number, signal: AbortSignal | undefined): boolean {
    return !this.disposed && generation === this.generation && signal?.aborted !== true;
  }

  private async findCompileCommand(
    request: ResolveProjectContextRequest,
    generation: number
  ): Promise<CompileCommandContext | undefined> {
    const workspace = request.workspace;
    if (workspace === undefined) {
      return undefined;
    }
    const configuredPath = request.configuration.compileCommandsPath;
    const explicitlyConfigured = configuredPath.trim().length > 0;
    for (const path of compilationDatabasePaths(workspace.rootPath, configuredPath)) {
      if (!this.isCurrent(generation, request.signal)) {
        return undefined;
      }
      let pending = lruGet(this.compilationDatabases, path);
      if (pending === undefined) {
        pending = Promise.resolve()
          .then(async () => await this.dependencies.readTextFile(path))
          .then((content) => parseCompilationDatabase(content))
          .then(
            (contexts) => Object.freeze({ contexts }),
            (error: unknown) => Object.freeze({ error })
          );
        lruSet(this.compilationDatabases, path, pending, this.maxEntries);
      }
      const awaited = await awaitWithSignal(pending, request.signal);
      if (awaited.aborted || !this.isCurrent(generation, request.signal)) {
        return undefined;
      }
      const result = awaited.value;
      if (result?.contexts !== undefined) {
        const command = findCompilationCommand(result.contexts, request.documentPath);
        if (command !== undefined) {
          return command;
        }
        continue;
      }
      if (this.compilationDatabases.get(path) === pending) {
        this.compilationDatabases.delete(path);
      }
      if (explicitlyConfigured) {
        this.reportOnce(Object.freeze({
          category: "compileCommands",
          key: path,
          message: "Configured compilation database is unavailable or invalid.",
          ...(result?.error === undefined ? {} : { error: result.error })
        }));
      }
    }
    return undefined;
  }

  private async resolveMetadata(
    request: ResolveProjectContextRequest,
    generation: number,
    iniContent: string,
    defaultEnvironmentNames: readonly string[]
  ): Promise<SelectedMetadata> {
    const workspace = request.workspace;
    if (workspace === undefined) {
      return Object.freeze({ aborted: false });
    }
    const requestedEnvironment = request.configuration.platformioEnvironment.trim();
    const executablePath = request.configuration.platformioExecutable;
    const key = JSON.stringify([
      workspace.cacheKey,
      requestedEnvironment,
      executablePath,
      hashText(iniContent)
    ]);
    const selection = Object.freeze({
      key,
      requestedEnvironment,
      defaultEnvironmentNames
    });
    const cached = this.getCachedMetadata(selection);
    if (cached !== undefined) {
      return cached;
    }

    const pending = lruGet(this.pendingMetadata, key)
      ?? this.createPendingMetadata(request, generation, selection);
    return await this.waitForMetadata(request, generation, selection, pending);
  }

  private getCachedMetadata(selection: MetadataSelection): SelectedMetadata | undefined {
    const cached = lruGet(this.metadata, selection.key);
    if (cached === undefined) {
      return undefined;
    }
    if (cached.expiresAt <= this.dependencies.now()) {
      this.metadata.delete(selection.key);
      return undefined;
    }
    return this.selectMetadata(cached.contexts, selection);
  }

  private createPendingMetadata(
    request: ResolveProjectContextRequest,
    generation: number,
    selection: MetadataSelection
  ): PendingMetadataEntry {
    const workspace = request.workspace;
    if (workspace === undefined) {
      throw new Error("PlatformIO metadata requires a local workspace.");
    }
    const controller = new AbortController();
    const requestedEnvironment = selection.requestedEnvironment;
    const result = Promise.resolve().then(async () => await this.dependencies.runMetadata({
      executablePath: request.configuration.platformioExecutable,
      projectDir: workspace.rootPath,
      ...(requestedEnvironment.length === 0 ? {} : { environmentName: requestedEnvironment }),
      signal: controller.signal
    })).then(
      (contexts) => Object.freeze({ contexts }),
      (error: unknown) => Object.freeze({ error })
    );
    const pending = Object.freeze({
      controller,
      generation,
      result,
      waiters: new Set<symbol>()
    });
    lruSet(
      this.pendingMetadata,
      selection.key,
      pending,
      this.maxEntries,
      (entry) => entry.controller.abort()
    );
    return pending;
  }

  private async waitForMetadata(
    request: ResolveProjectContextRequest,
    generation: number,
    selection: MetadataSelection,
    pending: PendingMetadataEntry
  ): Promise<SelectedMetadata> {
    const waiter = Symbol(selection.key);
    pending.waiters.add(waiter);
    let cancelled = false;
    try {
      const awaited = await awaitWithSignal(pending.result, request.signal);
      cancelled = awaited.aborted;
      if (awaited.aborted
        || !this.isCurrent(generation, request.signal)
        || pending.generation !== generation
        || this.pendingMetadata.get(selection.key) !== pending) {
        return Object.freeze({ aborted: true });
      }
      return this.acceptMetadataResult(awaited.value, selection, pending);
    } finally {
      pending.waiters.delete(waiter);
      if (pending.waiters.size === 0
        && this.pendingMetadata.get(selection.key) === pending) {
        this.pendingMetadata.delete(selection.key);
        if (cancelled) {
          pending.controller.abort();
        }
      }
    }
  }

  private acceptMetadataResult(
    result: MetadataResult | undefined,
    selection: MetadataSelection,
    pending: PendingMetadataEntry
  ): SelectedMetadata {
    if (result?.contexts === undefined) {
      if (pending.controller.signal.aborted) {
        return Object.freeze({ aborted: true });
      }
      const error = result?.error;
      this.reportOnce(Object.freeze({
        category: "platformio",
        key: selection.key,
        message: error instanceof Error ? error.message : "Unknown PlatformIO metadata error.",
        ...(error === undefined ? {} : { error })
      }));
      return Object.freeze({ aborted: false });
    }

    lruSet(this.metadata, selection.key, Object.freeze({
      expiresAt: this.dependencies.now() + this.metadataTtlMs,
      contexts: result.contexts
    }), this.maxEntries);
    return this.selectMetadata(result.contexts, selection);
  }

  private selectMetadata(
    contexts: readonly PlatformioCompilationContext[],
    selection: MetadataSelection
  ): SelectedMetadata {
    const selected = selectPlatformioContext(
      contexts,
      selection.requestedEnvironment,
      selection.defaultEnvironmentNames
    );
    return Object.freeze({
      aborted: false,
      ...(selected === undefined ? {} : { context: selected })
    });
  }

  private reportOnce(diagnostic: ProjectContextDiagnostic): void {
    const dedupeKey = `${diagnostic.category}:${diagnostic.key}`;
    if (lruGet(this.reportedDiagnostics, dedupeKey) !== undefined) {
      return;
    }
    lruSet(this.reportedDiagnostics, dedupeKey, true, this.maxEntries);
    this.dependencies.report(diagnostic);
  }
}
