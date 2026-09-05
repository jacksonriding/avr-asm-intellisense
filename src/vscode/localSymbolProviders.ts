import * as vscode from "vscode";

import { createDocumentSnapshot, type LocalDefinitionKind, type TextRange } from "../core/documentSnapshot";
import {
  localSymbolTokenAtOffset,
  localDefinitionTargets,
  localDocumentSymbols,
  localSymbolCompletions,
  localSymbolHover
} from "../core/localSymbols";
import { findDefinitions } from "../core/documentSnapshot";

export interface CrossFileSymbolCompletion {
  readonly label: string;
  readonly detail: string;
}

interface LocalSymbolProviderOptions {
  readonly crossFileCompletions?: ReadonlyArray<CrossFileSymbolCompletion>;
}

interface WorkspaceDocumentSnapshot {
  readonly document: vscode.TextDocument;
  readonly snapshot: ReturnType<typeof createDocumentSnapshot>;
}

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

function completionItemsFromDefinitions(
  definitions: readonly CrossFileSymbolCompletion[],
  seen: Set<string>
): vscode.CompletionItem[] {
  return definitions.flatMap((completion): readonly vscode.CompletionItem[] => {
    if (seen.has(completion.label)) {
      return [];
    }
    seen.add(completion.label);
    const item = new vscode.CompletionItem(completion.label, vscode.CompletionItemKind.Reference);
    item.detail = completion.detail;
    return [item];
  });
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

function workspaceDocumentSnapshots(excludeUri?: string): readonly WorkspaceDocumentSnapshot[] {
  return Object.freeze(vscode.workspace.textDocuments
    .filter((document) => (
      document.languageId === "avr-asm"
      && (excludeUri === undefined || document.uri.toString() !== excludeUri)
    ))
    .map((document) => Object.freeze({
      document,
      snapshot: createDocumentSnapshot(document.getText(), document.version)
    })));
}

function workspaceSymbolsForQuery(query: string): readonly vscode.SymbolInformation[] {
  const normalized = query.trim();
  const files = workspaceDocumentSnapshots();
  return Object.freeze(files.flatMap(({ document, snapshot }) => snapshot.definitions
    .filter((definition) => (
      normalized.length === 0
      || definition.name.includes(normalized)
    ))
    .map((definition) => ({
      name: definition.name,
      kind: symbolKind(definition.kind),
      location: new vscode.Location(document.uri, vscodeRange(document, definition.nameRange)),
      containerName: document.uri.path
    }))));
}

function crossFileDefinitionTargets(
  sourceDocument: vscode.TextDocument,
  targetName: string
): readonly vscode.Location[] {
  return Object.freeze(
    workspaceDocumentSnapshots(sourceDocument.uri.toString())
      .flatMap(({ document, snapshot }) => findDefinitions(snapshot, targetName)
        .map((definition) => new vscode.Location(document.uri, vscodeRange(document, definition.nameRange)))
      )
  );
}

export function registerLocalSymbolProviders(
  options: LocalSymbolProviderOptions = {}
): readonly vscode.Disposable[] {
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
      const offset = document.offsetAt(position);
      const localCompletions = localSymbolCompletions(
        snapshotFor(document),
        offset
      );
      const seen = new Set(localCompletions.map(({ label }) => label));
      const crossFileCompletions = completionItemsFromDefinitions(
        options.crossFileCompletions ?? [],
        seen
      );
      return localCompletions.map((completion) => {
        const item = new vscode.CompletionItem(completion.label, completionKind(completion.kind));
        item.detail = completion.detail;
        return item;
      }).concat(crossFileCompletions);
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
      const localTargets = localDefinitionTargets(
        snapshotFor(document),
        document.offsetAt(position)
      ).map((target) => new vscode.Location(
        document.uri,
        vscodeRange(document, target.targetSelectionRange)
      ));
      if (localTargets.length > 0) {
        return [...localTargets];
      }
      const token = localSymbolTokenAtOffset(snapshotFor(document), document.offsetAt(position));
      if (token === undefined || token.direction !== undefined
        || token.name[0] === undefined || token.name[0] >= "0" && token.name[0] <= "9") {
        return [];
      }
      return [...crossFileDefinitionTargets(document, token.name)];
    }
  };

  const workspaceSymbolProvider: vscode.WorkspaceSymbolProvider = {
    provideWorkspaceSymbols(query): vscode.SymbolInformation[] {
      return [...workspaceSymbolsForQuery(query)];
    }
  };

  return Object.freeze([
    vscode.languages.registerCompletionItemProvider("avr-asm", completionProvider),
    vscode.languages.registerDocumentSymbolProvider("avr-asm", documentSymbolProvider),
    vscode.languages.registerHoverProvider("avr-asm", hoverProvider),
    vscode.languages.registerDefinitionProvider("avr-asm", definitionProvider),
    vscode.languages.registerWorkspaceSymbolProvider(workspaceSymbolProvider)
  ]);
}
