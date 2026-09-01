import { existsSync } from "node:fs";
import { homedir } from "node:os";

import * as vscode from "vscode";

import { buildCompletionCandidates } from "./core/completions";
import {
  formatActiveContext,
  type CompilationContext
} from "./core/compilationContext";
import {
  ProjectContextService,
  type ProjectContextDiagnostic
} from "./core/projectContext";
import { discoverPlatformioExecutable } from "./core/platformioExecutable";
import {
  runPlatformioMetadata
} from "./core/platformioMetadata";
import { runAvrPreprocessor } from "./core/preprocessor";
import type { AvrMacro, CompletionKind } from "./core/types";
import { registerInstructionProviders } from "./vscode/instructionProviders";
import { registerLocalSymbolProviders } from "./vscode/localSymbolProviders";

interface SymbolCache {
  readonly key: string;
  readonly macros: readonly AvrMacro[];
}

const completionKinds: Readonly<Record<CompletionKind, vscode.CompletionItemKind>> = {
  instruction: vscode.CompletionItemKind.Keyword,
  register: vscode.CompletionItemKind.Variable,
  directive: vscode.CompletionItemKind.Keyword,
  device: vscode.CompletionItemKind.Constant
};

function findPlatformioExecutable(configuredPath: string): string {
  const customPath = vscode.workspace.getConfiguration("platformio-ide").get<string | null>(
    "customPATH",
    null
  );
  return discoverPlatformioExecutable(Object.freeze({
    configuredPath,
    customPath: customPath ?? undefined,
    homeDirectory: homedir(),
    platform: process.platform
  }), existsSync);
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

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("AVR Assembly IntelliSense");
  let cache: SymbolCache | undefined;
  const activeProcessControllers = new Set<AbortController>();
  const projectContexts = new ProjectContextService(Object.freeze({
    readTextFile: async (path: string): Promise<string> => Buffer.from(
      await vscode.workspace.fs.readFile(vscode.Uri.file(path))
    ).toString("utf8"),
    runMetadata: runPlatformioMetadata,
    report: (diagnostic: ProjectContextDiagnostic) => output.appendLine(diagnostic.message),
    now: Date.now
  }));

  const abortActiveProcesses = (): void => {
    for (const controller of activeProcessControllers) {
      controller.abort();
    }
    activeProcessControllers.clear();
  };

  const processScope = (cancellationToken?: vscode.CancellationToken): Readonly<{
    signal: AbortSignal;
    dispose(): void;
  }> => {
    const controller = new AbortController();
    activeProcessControllers.add(controller);
    const cancellationSubscription = cancellationToken?.onCancellationRequested(
      () => controller.abort()
    );
    if (cancellationToken?.isCancellationRequested === true) {
      controller.abort();
    }
    return Object.freeze({
      signal: controller.signal,
      dispose: () => {
        cancellationSubscription?.dispose();
        activeProcessControllers.delete(controller);
      }
    });
  };

  const clearCaches = (): void => {
    abortActiveProcesses();
    cache = undefined;
    projectContexts.clear();
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

  const resolveContext = async (
    document: vscode.TextDocument,
    signal?: AbortSignal
  ): Promise<CompilationContext | undefined> => {
    const configuration = vscode.workspace.getConfiguration("avrAsmIntellisense", document.uri);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const localWorkspace = workspaceFolder?.uri.scheme === "file" ? workspaceFolder : undefined;
    return await projectContexts.resolve(Object.freeze({
      documentPath: document.uri.fsPath,
      ...(localWorkspace === undefined ? {} : {
        workspace: Object.freeze({
          rootPath: localWorkspace.uri.fsPath,
          cacheKey: localWorkspace.uri.toString()
        })
      }),
      configuration: Object.freeze({
        compilerPath: configuration.get<string>("compilerPath", ""),
        mcu: configuration.get<string>("mcu", ""),
        compileCommandsPath: configuration.get<string>("compileCommandsPath", ""),
        platformioEnvironment: configuration.get<string>("platformioEnvironment", ""),
        platformioExecutable: localWorkspace === undefined
          ? "pio"
          : findPlatformioExecutable(configuration.get<string>("platformioPath", "")),
        usePlatformioMetadata: configuration.get<boolean>("usePlatformioMetadata", true)
      }),
      ...(signal === undefined ? {} : { signal })
    }));
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
      const scope = processScope();
      try {
        output.appendLine(formatActiveContext(await resolveContext(document, scope.signal)));
      } catch {
        if (!scope.signal.aborted) {
          output.appendLine("Unable to resolve the active AVR context. Static completions remain available.");
        }
      } finally {
        scope.dispose();
      }
      output.show(true);
    }
  );

  const localSymbolProviders = registerLocalSymbolProviders();
  const provider = vscode.languages.registerCompletionItemProvider("avr-asm", {
    async provideCompletionItems(document, _position, cancellationToken): Promise<vscode.CompletionItem[]> {
      let macros: readonly AvrMacro[] = [];
      const trusted = vscode.workspace.isTrusted;
      if (!trusted || cancellationToken.isCancellationRequested) {
        return completionItems(macros);
      }
      const scope = processScope(cancellationToken);
      try {
        const toolchain = await resolveContext(document, scope.signal);
        if (toolchain !== undefined && !scope.signal.aborted) {
          const toolchainKey = JSON.stringify(toolchain);
          const key = `${document.uri.toString()}:${document.version}:${toolchainKey}`;
          if (cache?.key !== key) {
            const source = `#include <avr/io.h>\n${document.getText()}`;
            cache = Object.freeze({
              key,
              macros: await runAvrPreprocessor({ ...toolchain, source, signal: scope.signal })
            });
          }
          macros = cache.macros;
        }
      } catch (error: unknown) {
        if (!scope.signal.aborted) {
          const message = error instanceof Error ? error.message : "Unknown preprocessing error.";
          output.appendLine(message);
        }
      } finally {
        scope.dispose();
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
    {
      dispose: () => {
        abortActiveProcesses();
        projectContexts.dispose();
      }
    },
    ...localSymbolProviders,
    ...instructionProviders
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered on the extension context.
}
