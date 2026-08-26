import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import * as vscode from "vscode";

import { buildCompletionCandidates } from "./core/completions";
import { parsePlatformioConfig, selectPlatformioMcu } from "./core/platformio";
import {
  runPlatformioMetadata,
  selectPlatformioContext,
  type PlatformioCompilationContext
} from "./core/platformioMetadata";
import { runAvrPreprocessor } from "./core/preprocessor";
import { resolveAvrToolchain, type ResolvedAvrToolchain } from "./core/toolchainContext";
import type { AvrMacro, CompletionKind } from "./core/types";

interface SymbolCache {
  readonly key: string;
  readonly macros: readonly AvrMacro[];
}

interface MetadataCacheEntry {
  readonly expiresAt: number;
  readonly result: Promise<readonly PlatformioCompilationContext[]>;
}

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
    return item;
  });
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
  const loggedMetadataErrors = new Set<string>();

  const clearCaches = (): void => {
    cache = undefined;
    metadataCache.clear();
    loggedMetadataErrors.clear();
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

  const resolveToolchain = async (
    document: vscode.TextDocument
  ): Promise<ResolvedAvrToolchain | undefined> => {
    const configuration = vscode.workspace.getConfiguration("avrAsmIntellisense", document.uri);
    const configuredMcu = configuration.get<string>("mcu", "");
    const configuredCompilerPath = configuration.get<string>("compilerPath", "");
    const requestedEnvironment = configuration.get<string>("platformioEnvironment", "").trim();
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (workspaceFolder === undefined || workspaceFolder.uri.scheme !== "file") {
      return resolveAvrToolchain({ configuredCompilerPath, configuredMcu });
    }

    let iniContent = "";
    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(workspaceFolder.uri, "platformio.ini")
      );
      iniContent = Buffer.from(bytes).toString("utf8");
    } catch {
      return resolveAvrToolchain({ configuredCompilerPath, configuredMcu });
    }

    const iniConfig = parsePlatformioConfig(iniContent);
    const iniMcu = selectPlatformioMcu(iniConfig, requestedEnvironment);
    let metadata: PlatformioCompilationContext | undefined;
    if (configuration.get<boolean>("usePlatformioMetadata", true)) {
      const platformioPath = findPlatformioExecutable(
        configuration.get<string>("platformioPath", "")
      );
      const metadataKey = [
        workspaceFolder.uri.toString(),
        requestedEnvironment,
        platformioPath,
        hashText(iniContent)
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
        const contexts = await entry.result;
        metadata = selectPlatformioContext(
          contexts,
          requestedEnvironment,
          iniConfig.defaultEnvironmentNames
        );
      } catch (error: unknown) {
        metadataCache.delete(metadataKey);
        if (!loggedMetadataErrors.has(metadataKey)) {
          loggedMetadataErrors.add(metadataKey);
          const message = error instanceof Error ? error.message : "Unknown PlatformIO metadata error.";
          output.appendLine(message);
        }
      }
    }

    return resolveAvrToolchain({
      configuredCompilerPath,
      configuredMcu,
      ...(metadata === undefined ? {} : { metadata }),
      ...(iniMcu === undefined ? {} : { iniMcu })
    });
  };

  const provider = vscode.languages.registerCompletionItemProvider("avr-asm", {
    async provideCompletionItems(document, _position, cancellationToken): Promise<vscode.CompletionItem[]> {
      let macros: readonly AvrMacro[] = [];
      const trusted = vscode.workspace.isTrusted;
      if (!trusted || cancellationToken.isCancellationRequested) {
        return completionItems(macros);
      }
      const toolchain = await resolveToolchain(document);

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

  context.subscriptions.push(output, provider, configurationWatcher, platformioWatcher);
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered on the extension context.
}
