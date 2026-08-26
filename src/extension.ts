import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, resolve as resolvePath } from "node:path";

import * as vscode from "vscode";

import { buildCompletionCandidates } from "./core/completions";
import {
  findCompilationCommand,
  parseCompilationDatabase,
  type CompileCommandContext
} from "./core/compileCommands";
import {
  formatActiveContext,
  resolveCompilationContext,
  type CompilationContext
} from "./core/compilationContext";
import { parsePlatformioConfig, selectPlatformioMcu } from "./core/platformio";
import {
  runPlatformioMetadata,
  selectPlatformioContext,
  type PlatformioCompilationContext
} from "./core/platformioMetadata";
import { runAvrPreprocessor } from "./core/preprocessor";
import type { AvrMacro, CompletionKind } from "./core/types";
import { registerInstructionProviders } from "./vscode/instructionProviders";

interface SymbolCache {
  readonly key: string;
  readonly macros: readonly AvrMacro[];
}

interface MetadataCacheEntry {
  readonly expiresAt: number;
  readonly result: Promise<readonly PlatformioCompilationContext[]>;
}

type CompilationDatabaseCache = Map<string, Promise<readonly CompileCommandContext[]>>;

const METADATA_TTL_MS = 5 * 60 * 1_000;
const MAX_METADATA_CACHE_ENTRIES = 16;

const completionKinds: Readonly<Record<CompletionKind, vscode.CompletionItemKind>> = {
  instruction: vscode.CompletionItemKind.Keyword,
  register: vscode.CompletionItemKind.Variable,
  directive: vscode.CompletionItemKind.Keyword,
  device: vscode.CompletionItemKind.Constant
};

function findPlatformioExecutable(configuredPath: string): string {
  if (configuredPath.trim().length > 0) {
    return configuredPath.trim();
  }

  const executableName = process.platform === "win32" ? "platformio.exe" : "platformio";
  const customPath = vscode.workspace.getConfiguration("platformio-ide").get<string | null>(
    "customPATH",
    null
  );
  if (customPath !== null) {
    for (const directory of customPath.split(delimiter)) {
      const candidate = join(directory, executableName);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  const standardPath = process.platform === "win32"
    ? join(homedir(), ".platformio", "penv", "Scripts", executableName)
    : join(homedir(), ".platformio", "penv", "bin", executableName);
  return existsSync(standardPath) ? standardPath : "pio";
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function completionItems(macros: readonly AvrMacro[]): vscode.CompletionItem[] {
  return buildCompletionCandidates(macros).map((candidate) => {
    const item = new vscode.CompletionItem(candidate.label, completionKinds[candidate.kind]);
    item.detail = candidate.detail;
    if (candidate.documentation !== undefined) {
      const documentation = new vscode.MarkdownString(candidate.documentation);
      documentation.isTrusted = false;
      documentation.supportHtml = false;
      item.documentation = documentation;
    }
    return item;
  });
}

function compilationDatabaseUris(
  workspaceFolder: vscode.WorkspaceFolder,
  configuredPath: string
): readonly vscode.Uri[] {
  const selectedPath = configuredPath.trim();
  if (selectedPath.length > 0) {
    const filePath = isAbsolute(selectedPath)
      ? selectedPath
      : resolvePath(workspaceFolder.uri.fsPath, selectedPath);
    return Object.freeze([vscode.Uri.file(filePath)]);
  }
  return Object.freeze([
    vscode.Uri.joinPath(workspaceFolder.uri, "compile_commands.json"),
    vscode.Uri.joinPath(workspaceFolder.uri, "build", "compile_commands.json")
  ]);
}

function boundedCacheSet(
  cache: Map<string, MetadataCacheEntry>,
  key: string,
  value: MetadataCacheEntry
): void {
  if (cache.size >= MAX_METADATA_CACHE_ENTRIES) {
    cache.clear();
  }
  cache.set(key, value);
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("AVR Assembly IntelliSense");
  let cache: SymbolCache | undefined;
  const metadataCache = new Map<string, MetadataCacheEntry>();
  const compilationDatabaseCache: CompilationDatabaseCache = new Map();
  const loggedMetadataErrors = new Set<string>();
  const loggedCompilationDatabaseErrors = new Set<string>();

  const clearCaches = (): void => {
    cache = undefined;
    metadataCache.clear();
    compilationDatabaseCache.clear();
    loggedMetadataErrors.clear();
    loggedCompilationDatabaseErrors.clear();
  };

  const configurationWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("avrAsmIntellisense")) {
      clearCaches();
    }
  });
  const platformioWatcher = vscode.workspace.createFileSystemWatcher("**/platformio.ini");
  platformioWatcher.onDidChange(clearCaches);
  platformioWatcher.onDidCreate(clearCaches);
  platformioWatcher.onDidDelete(clearCaches);
  const compilationDatabaseWatcher = vscode.workspace.createFileSystemWatcher(
    "**/compile_commands.json"
  );
  compilationDatabaseWatcher.onDidChange(clearCaches);
  compilationDatabaseWatcher.onDidCreate(clearCaches);
  compilationDatabaseWatcher.onDidDelete(clearCaches);

  const findCompileCommandForDocument = async (
    document: vscode.TextDocument,
    workspaceFolder: vscode.WorkspaceFolder,
    configuredPath: string
  ): Promise<CompileCommandContext | undefined> => {
    const isConfigured = configuredPath.trim().length > 0;
    for (const databaseUri of compilationDatabaseUris(workspaceFolder, configuredPath)) {
      const cacheKey = databaseUri.toString();
      const cachedContexts = compilationDatabaseCache.get(cacheKey);
      const pendingContexts = cachedContexts ?? Promise.resolve(
        vscode.workspace.fs.readFile(databaseUri)
      ).then((bytes) => parseCompilationDatabase(Buffer.from(bytes).toString("utf8")));
      if (cachedContexts === undefined) {
        compilationDatabaseCache.set(cacheKey, pendingContexts);
      }
      try {
        const command = findCompilationCommand(await pendingContexts, document.uri.fsPath);
        if (command !== undefined) {
          return command;
        }
      } catch {
        compilationDatabaseCache.delete(cacheKey);
        if (isConfigured && !loggedCompilationDatabaseErrors.has(cacheKey)) {
          loggedCompilationDatabaseErrors.add(cacheKey);
          output.appendLine("Configured compilation database is unavailable or invalid.");
        }
      }
    }
    return undefined;
  };

  const resolvePlatformioMetadata = async (
    workspaceFolder: vscode.WorkspaceFolder,
    iniContent: string,
    requestedEnvironment: string,
    defaultEnvironmentNames: readonly string[],
    configuration: vscode.WorkspaceConfiguration
  ): Promise<PlatformioCompilationContext | undefined> => {
    if (!configuration.get<boolean>("usePlatformioMetadata", true)) {
      return undefined;
    }
    const platformioPath = findPlatformioExecutable(configuration.get<string>("platformioPath", ""));
    const metadataKey = [
      workspaceFolder.uri.toString(), requestedEnvironment, platformioPath, hashText(iniContent)
    ].join(":");
    let entry = metadataCache.get(metadataKey);
    if (entry === undefined || entry.expiresAt <= Date.now()) {
      entry = Object.freeze({
        expiresAt: Date.now() + METADATA_TTL_MS,
        result: runPlatformioMetadata({
          executablePath: platformioPath,
          projectDir: workspaceFolder.uri.fsPath,
          ...(requestedEnvironment.length > 0 ? { environmentName: requestedEnvironment } : {})
        })
      });
      boundedCacheSet(metadataCache, metadataKey, entry);
    }
    try {
      return selectPlatformioContext(
        await entry.result,
        requestedEnvironment,
        defaultEnvironmentNames
      );
    } catch (error: unknown) {
      metadataCache.delete(metadataKey);
      if (!loggedMetadataErrors.has(metadataKey)) {
        loggedMetadataErrors.add(metadataKey);
        const message = error instanceof Error ? error.message : "Unknown PlatformIO metadata error.";
        output.appendLine(message);
      }
      return undefined;
    }
  };

  const resolveContext = async (
    document: vscode.TextDocument
  ): Promise<CompilationContext | undefined> => {
    const configuration = vscode.workspace.getConfiguration("avrAsmIntellisense", document.uri);
    const configuredMcu = configuration.get<string>("mcu", "");
    const configuredCompilerPath = configuration.get<string>("compilerPath", "");
    const requestedEnvironment = configuration.get<string>("platformioEnvironment", "").trim();
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (workspaceFolder === undefined || workspaceFolder.uri.scheme !== "file") {
      return resolveCompilationContext({ configuredCompilerPath, configuredMcu });
    }

    const compileCommand = await findCompileCommandForDocument(
      document,
      workspaceFolder,
      configuration.get<string>("compileCommandsPath", "")
    );
    if (compileCommand !== undefined) {
      return resolveCompilationContext({
        configuredCompilerPath,
        configuredMcu,
        compileCommand
      });
    }

    let iniContent = "";
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(workspaceFolder.uri, "platformio.ini")
      );
      iniContent = Buffer.from(bytes).toString("utf8");
    } catch {
      return resolveCompilationContext({ configuredCompilerPath, configuredMcu });
    }

    const iniConfig = parsePlatformioConfig(iniContent);
    const iniMcu = selectPlatformioMcu(iniConfig, requestedEnvironment);
    const metadata = await resolvePlatformioMetadata(
      workspaceFolder,
      iniContent,
      requestedEnvironment,
      iniConfig.defaultEnvironmentNames,
      configuration
    );

    return resolveCompilationContext({
      configuredCompilerPath,
      configuredMcu,
      ...(metadata === undefined ? {} : { platformio: metadata }),
      ...(iniMcu === undefined ? {} : { iniMcu })
    });
  };

  const showActiveContext = vscode.commands.registerCommand(
    "avrAsmIntellisense.showActiveContext",
    async (): Promise<void> => {
      const document = vscode.window.activeTextEditor?.document;
      if (document === undefined || document.languageId !== "avr-asm") {
        await vscode.window.showInformationMessage("Open an AVR assembly file to inspect its context.");
        return;
      }
      if (!vscode.workspace.isTrusted) {
        output.appendLine(
          "Workspace trust is required for AVR project discovery. Static completions remain available."
        );
        output.show(true);
        return;
      }
      try {
        output.appendLine(formatActiveContext(await resolveContext(document)));
      } catch {
        output.appendLine("Unable to resolve the active AVR context. Static completions remain available.");
      }
      output.show(true);
    }
  );

  const provider = vscode.languages.registerCompletionItemProvider("avr-asm", {
    async provideCompletionItems(document, _position, cancellationToken): Promise<vscode.CompletionItem[]> {
      let macros: readonly AvrMacro[] = [];
      const trusted = vscode.workspace.isTrusted;
      if (!trusted || cancellationToken.isCancellationRequested) {
        return completionItems(macros);
      }
      const toolchain = await resolveContext(document);

      if (toolchain !== undefined && !cancellationToken.isCancellationRequested) {
        const toolchainKey = JSON.stringify(toolchain);
        const key = `${document.uri.toString()}:${document.version}:${toolchainKey}`;
        try {
          if (cache?.key !== key) {
            const source = `#include <avr/io.h>\n${document.getText()}`;
            cache = Object.freeze({
              key,
              macros: await runAvrPreprocessor({ ...toolchain, source })
            });
          }
          macros = cache.macros;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown preprocessing error.";
          output.appendLine(message);
        }
      }

      return completionItems(macros);
    }
  });
  const instructionProviders = registerInstructionProviders();

  context.subscriptions.push(
    output,
    provider,
    showActiveContext,
    configurationWatcher,
    platformioWatcher,
    compilationDatabaseWatcher,
    ...instructionProviders
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered on the extension context.
}
