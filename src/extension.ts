import * as vscode from "vscode";

import { buildCompletionCandidates } from "./core/completions";
import { parsePlatformioConfig, selectPlatformioMcu } from "./core/platformio";
import { runAvrPreprocessor } from "./core/preprocessor";
import type { AvrMacro, CompletionKind } from "./core/types";

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

async function resolveMcu(document: vscode.TextDocument): Promise<string> {
  const configuration = vscode.workspace.getConfiguration("avrAsmIntellisense", document.uri);
  const configuredMcu = configuration.get<string>("mcu", "").trim();
  if (configuredMcu.length > 0) {
    return configuredMcu;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (workspaceFolder === undefined) {
    return "";
  }

  try {
    const platformioIni = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(workspaceFolder.uri, "platformio.ini")
    );
    const requestedEnvironment = configuration.get<string>("platformioEnvironment", "");
    return selectPlatformioMcu(
      parsePlatformioConfig(Buffer.from(platformioIni).toString("utf8")),
      requestedEnvironment
    ) ?? "";
  } catch {
    return "";
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("AVR Assembly IntelliSense");
  let cache: SymbolCache | undefined;

  const provider = vscode.languages.registerCompletionItemProvider("avr-asm", {
    async provideCompletionItems(document): Promise<vscode.CompletionItem[]> {
      let macros: readonly AvrMacro[] = [];
      const configuration = vscode.workspace.getConfiguration("avrAsmIntellisense", document.uri);
      const compilerPath = configuration.get<string>("compilerPath", "avr-gcc");
      const trusted = vscode.workspace.isTrusted;
      const mcu = trusted ? await resolveMcu(document) : "";

      if (trusted && mcu.length > 0) {
        const key = `${document.uri.toString()}:${document.version}:${compilerPath}:${mcu}`;
        try {
          if (cache?.key !== key) {
            const source = `#include <avr/io.h>\n${document.getText()}`;
            cache = Object.freeze({
              key,
              macros: await runAvrPreprocessor({ compilerPath, mcu, source })
            });
          }
          macros = cache.macros;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown preprocessing error.";
          output.appendLine(message);
        }
      }

      return buildCompletionCandidates(macros).map((candidate) => {
        const item = new vscode.CompletionItem(candidate.label, completionKinds[candidate.kind]);
        item.detail = candidate.detail;
        return item;
      });
    }
  });

  context.subscriptions.push(output, provider);
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered on the extension context.
}
