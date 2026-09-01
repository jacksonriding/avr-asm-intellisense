import * as vscode from "vscode";

import { createDocumentSnapshot, type LocalDefinitionKind, type TextRange } from "../core/documentSnapshot";
import {
  localDefinitionTargets,
  localDocumentSymbols,
  localSymbolCompletions,
  localSymbolHover
} from "../core/localSymbols";

interface CachedSnapshot {
  readonly documentKey: string;
  readonly version: number;
  readonly snapshot: ReturnType<typeof createDocumentSnapshot>;
}

function completionKind(kind: LocalDefinitionKind): vscode.CompletionItemKind {
  switch (kind) {
    case "equ":
    case "equiv":
      return vscode.CompletionItemKind.Constant;
    case "set":
    case "assignment":
      return vscode.CompletionItemKind.Variable;
    default:
      return vscode.CompletionItemKind.Reference;
  }
}

function symbolKind(kind: LocalDefinitionKind): vscode.SymbolKind {
  switch (kind) {
    case "numericLabel":
      return vscode.SymbolKind.Number;
    case "equ":
    case "equiv":
      return vscode.SymbolKind.Constant;
    case "set":
    case "assignment":
      return vscode.SymbolKind.Variable;
    default:
      return vscode.SymbolKind.Function;
  }
}

function vscodeRange(document: vscode.TextDocument, range: TextRange): vscode.Range {
  return new vscode.Range(document.positionAt(range.start), document.positionAt(range.end));
}

export function registerLocalSymbolProviders(): readonly vscode.Disposable[] {
  let cached: CachedSnapshot | undefined;
  const snapshotFor = (document: vscode.TextDocument): CachedSnapshot["snapshot"] => {
    const documentKey = document.uri.toString();
    if (cached?.documentKey === documentKey && cached.version === document.version) {
      return cached.snapshot;
    }
    const snapshot = createDocumentSnapshot(document.getText(), document.version);
    cached = Object.freeze({ documentKey, version: document.version, snapshot });
    return snapshot;
  };

  const completionProvider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position): vscode.CompletionItem[] {
      return localSymbolCompletions(
        snapshotFor(document),
        document.offsetAt(position)
      ).map((completion) => {
        const item = new vscode.CompletionItem(completion.label, completionKind(completion.kind));
        item.detail = completion.detail;
        return item;
      });
    }
  };

  const documentSymbolProvider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document): vscode.DocumentSymbol[] {
      return localDocumentSymbols(snapshotFor(document)).map((symbol) => new vscode.DocumentSymbol(
        symbol.name,
        symbol.detail,
        symbolKind(symbol.kind),
        vscodeRange(document, symbol.range),
        vscodeRange(document, symbol.selectionRange)
      ));
    }
  };

  const hoverProvider: vscode.HoverProvider = {
    provideHover(document, position): vscode.Hover | undefined {
      const hover = localSymbolHover(snapshotFor(document), document.offsetAt(position));
      if (hover === undefined) {
        return undefined;
      }
      const markdown = new vscode.MarkdownString();
      markdown.isTrusted = false;
      markdown.supportHtml = false;
      markdown.appendCodeblock(hover.name, "avr-asm");
      markdown.appendMarkdown("\n");
      markdown.appendText(hover.detail);
      if (hover.expression !== undefined) {
        markdown.appendMarkdown("\n\nExpression:\n");
        markdown.appendCodeblock(hover.expression, "avr-asm");
      }
      return new vscode.Hover(markdown, vscodeRange(document, hover.range));
    }
  };

  const definitionProvider: vscode.DefinitionProvider = {
    provideDefinition(document, position): vscode.Location[] {
      return localDefinitionTargets(
        snapshotFor(document),
        document.offsetAt(position)
      ).map((target) => new vscode.Location(
        document.uri,
        vscodeRange(document, target.targetSelectionRange)
      ));
    }
  };

  return Object.freeze([
    vscode.languages.registerCompletionItemProvider("avr-asm", completionProvider),
    vscode.languages.registerDocumentSymbolProvider("avr-asm", documentSymbolProvider),
    vscode.languages.registerHoverProvider("avr-asm", hoverProvider),
    vscode.languages.registerDefinitionProvider("avr-asm", definitionProvider)
  ]);
}
