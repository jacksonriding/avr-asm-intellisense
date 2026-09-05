import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workspaceTextDocuments: [] as Array<{
    readonly languageId: string;
    readonly uri: { readonly path: string; toString(): string };
    readonly version: number;
    readonly getText: () => string;
    readonly offsetAt: (position: { line: number; character: number }) => number;
    readonly positionAt: (offset: number) => { line: number; character: number };
  }>,
  completionProvider: undefined as undefined | {
    provideCompletionItems(document: unknown, position: unknown): unknown;
  },
  documentSymbolProvider: undefined as undefined | { provideDocumentSymbols(document: unknown): unknown },
  hoverProvider: undefined as undefined | { provideHover(document: unknown, position: unknown): unknown },
  definitionProvider: undefined as undefined | { provideDefinition(document: unknown, position: unknown): unknown },
  workspaceSymbolProvider: undefined as undefined | { provideWorkspaceSymbols(query: string): unknown[] }
}));

vi.mock("vscode", () => {
  class Position {
    constructor(readonly line: number, readonly character: number) {}
  }

  class Range {
    constructor(readonly start: Position, readonly end: Position) {}
  }

  class CompletionItem {
    detail?: string;
    constructor(readonly label: string, readonly kind: number) {}
  }

  class DocumentSymbol {
    constructor(
      readonly name: string,
      readonly detail: string,
      readonly kind: number,
      readonly range: Range,
      readonly selectionRange: Range
    ) {}
  }

  class MarkdownString {
    isTrusted = false;
    supportHtml = false;
    value = "";
    readonly markdownValues: string[] = [];
    readonly textValues: string[] = [];
    appendCodeblock(value: string): MarkdownString {
      this.value += `\n\`\`\`\n${value}\n\`\`\`\n`;
      return this;
    }
    appendMarkdown(value: string): MarkdownString {
      this.markdownValues.push(value);
      this.value += value;
      return this;
    }
    appendText(value: string): MarkdownString {
      this.textValues.push(value);
      this.value += value;
      return this;
    }
  }

  class Hover {
    constructor(readonly contents: MarkdownString, readonly range: Range) {}
  }

  class Location {
    constructor(readonly uri: unknown, readonly range: Range) {}
  }

  const disposable = () => ({ dispose: vi.fn() });
  return {
    CompletionItem,
    CompletionItemKind: { Reference: 1, Constant: 2, Variable: 3 },
    DocumentSymbol,
    Hover,
    Location,
    MarkdownString,
    Position,
    Range,
    SymbolKind: { Function: 10, Number: 11, Constant: 12, Variable: 13 },
    Uri: {
      file: (value: string) => ({
        path: value,
        toString: () => value
      })
    },
    languages: {
      registerCompletionItemProvider: (_language: string, provider: typeof mocks.completionProvider) => {
        mocks.completionProvider = provider;
        return disposable();
      },
      registerDocumentSymbolProvider: (
        _language: string,
        provider: typeof mocks.documentSymbolProvider
      ) => {
        mocks.documentSymbolProvider = provider;
        return disposable();
      },
      registerHoverProvider: (_language: string, provider: typeof mocks.hoverProvider) => {
        mocks.hoverProvider = provider;
        return disposable();
      },
      registerDefinitionProvider: (_language: string, provider: typeof mocks.definitionProvider) => {
        mocks.definitionProvider = provider;
        return disposable();
      },
      registerWorkspaceSymbolProvider: (
        provider: typeof mocks.workspaceSymbolProvider
      ) => {
        mocks.workspaceSymbolProvider = provider;
        return disposable();
      }
    },
    workspace: { textDocuments: mocks.workspaceTextDocuments }
  };
});

import { registerLocalSymbolProviders } from "../src/vscode/localSymbolProviders";

function document(
  source: string,
  uri = "file:///workspace/src/main.S",
  version = 1,
  languageId = "avr-asm"
) {
  const lines = source.split("\n");
  const lineStarts = lines.map((_line, index) => (
    index === 0 ? 0 : lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0)
  ));
  return {
    languageId,
    uri: {
      path: uri,
      toString: () => uri
    },
    version,
    getText: () => source,
    offsetAt: (position: { line: number; character: number }) =>
      (lineStarts[position.line] ?? source.length) + position.character,
    positionAt: (offset: number) => {
      const bounded = Math.max(0, Math.min(offset, source.length));
      let line = 0;
      while (line + 1 < lineStarts.length && (lineStarts[line + 1] ?? source.length) <= bounded) {
        line += 1;
      }
      return { line, character: bounded - (lineStarts[line] ?? 0) };
    }
  };
}

describe("local symbol providers", () => {
  beforeEach(() => {
    mocks.completionProvider = undefined;
    mocks.documentSymbolProvider = undefined;
    mocks.hoverProvider = undefined;
    mocks.definitionProvider = undefined;
    mocks.workspaceSymbolProvider = undefined;
    mocks.workspaceTextDocuments.splice(0, mocks.workspaceTextDocuments.length);
  });

  it("registers completion, document-symbol, hover, definition, and workspace-symbol providers", () => {
    const registrations = registerLocalSymbolProviders();

    expect(registrations).toHaveLength(5);
    expect(mocks.completionProvider).toBeDefined();
    expect(mocks.documentSymbolProvider).toBeDefined();
    expect(mocks.hoverProvider).toBeDefined();
    expect(mocks.definitionProvider).toBeDefined();
    expect(mocks.workspaceSymbolProvider).toBeDefined();
  });

  it("adapts immutable local symbol analysis to VS Code values", () => {
    registerLocalSymbolProviders();
    const source = [
      "start:",
      ".equ LIMIT, 3 + [unsafe](command:test)",
      "ldi r16, LIMIT",
      "rjmp start"
    ].join("\n");
    const activeDocument = document(source);

    const completions = mocks.completionProvider?.provideCompletionItems(
      activeDocument,
      { line: 0, character: 0 }
    ) as Array<{
      label: string;
      detail: string;
    }>;
    const symbols = mocks.documentSymbolProvider?.provideDocumentSymbols(activeDocument) as Array<{
      name: string;
      selectionRange: { start: { line: number; character: number } };
    }>;
    const hover = mocks.hoverProvider?.provideHover(
      activeDocument,
      { line: 2, character: 11 }
    ) as {
      contents: {
        value: string;
        isTrusted: boolean;
        supportHtml: boolean;
        markdownValues: string[];
        textValues: string[];
      };
      range: unknown;
    };
    const definitions = mocks.definitionProvider?.provideDefinition(
      activeDocument,
      { line: 3, character: 7 }
    ) as Array<{ uri: unknown; range: { start: { line: number; character: number } } }>;

    expect(completions.map(({ label }) => label)).toEqual(["start", "LIMIT"]);
    expect(completions[1]?.detail).toContain(".equ");
    expect(symbols.map(({ name }) => name)).toEqual(["start", "LIMIT"]);
    expect(symbols[1]?.selectionRange.start).toMatchObject({ line: 1, character: 5 });
    expect(hover.contents.value).toContain("LIMIT");
    expect(hover.contents.value).toContain("3");
    expect(hover.contents.isTrusted).toBe(false);
    expect(hover.contents.supportHtml).toBe(false);
    expect(hover.contents.markdownValues).not.toContain(expect.stringContaining("command:test"));
    expect(hover.contents.textValues.join("\n")).toContain("command:test");
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.range.start).toMatchObject({ line: 0, character: 0 });
  });

  it("resolves definitions across open AVR documents when symbol not defined in the current document", () => {
    const active = document("rjmp TARGET", "file:///workspace/src/main.S", 1);
    const referenced = document(".equ TARGET, 42", "file:///workspace/include.S", 1);
    mocks.workspaceTextDocuments.push(referenced);

    registerLocalSymbolProviders();

    const definition = mocks.definitionProvider?.provideDefinition(
      active,
      { line: 0, character: 5 }
    ) as Array<{ uri: { toString: () => string }; range: { start: { line: number; character: number } } }>;

    expect(definition).toHaveLength(1);
    expect(definition[0]?.uri.toString()).toBe("file:///workspace/include.S");
    expect(definition[0]?.range.start).toMatchObject({ line: 0, character: 5 });
  });

  it("provides workspace symbols from all open AVR documents", () => {
    const first = document(".equ TARGET, 42", "file:///workspace/src/one.S", 1);
    const second = document("LOCAL_START:\n.equ LOCAL_VAL, 1", "file:///workspace/src/two.S", 1);
    mocks.workspaceTextDocuments.push(first, second);

    registerLocalSymbolProviders();

    const symbols = mocks.workspaceSymbolProvider?.provideWorkspaceSymbols("LOCAL_VAL") as Array<{
      name: string;
      containerName: string;
    }>;

    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe("LOCAL_VAL");
    expect(symbols[0]?.containerName).toBe("file:///workspace/src/two.S");
  });

  it("rebuilds analysis for a new document version", () => {
    registerLocalSymbolProviders();
    const first = document("old_name:", 1);
    const second = document("new_name:", 2);

    const firstItems = mocks.completionProvider?.provideCompletionItems(
      first,
      { line: 0, character: 0 }
    ) as Array<{
      label: string;
    }>;
    const secondItems = mocks.completionProvider?.provideCompletionItems(
      second,
      { line: 0, character: 0 }
    ) as Array<{
      label: string;
    }>;

    expect(firstItems.map(({ label }) => label)).toEqual(["old_name"]);
    expect(secondItems.map(({ label }) => label)).toEqual(["new_name"]);
  });
});
