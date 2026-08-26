import * as vscode from "vscode";

import { buildCompletionCandidates } from "./core/completions";
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

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("AVR Assembly IntelliSense");
  let cache: SymbolCache | undefined;

  const provider = vscode.languages.registerCompletionItemProvider("avr-asm", {
    async provideCompletionItems(document): Promise<vscode.CompletionItem[]> {
      let macros: readonly AvrMacro[] = [];
      const configuration = vscode.workspace.getConfiguration("avrAsmIntellisense", document.uri);
      const compilerPath = configuration.get<string>("compilerPath", "avr-gcc");
      const mcu = configuration.get<string>("mcu", "");

      if (vscode.workspace.isTrusted && mcu.length > 0) {
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
