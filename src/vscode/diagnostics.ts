import * as vscode from "vscode";

import {
  buildDocumentDiagnostics,
  type ConditionalState,
  type DiagnosticsContext,
  type DocumentDiagnostic
} from "../core/diagnostics";
import { createDocumentSnapshot } from "../core/documentSnapshot";

export interface DiagnosticState {
  readonly resolveSymbol?: (name: string) => boolean;
  readonly conditionalStateAt?: (offset: number) => ConditionalState;
}

interface DiagnosticProviderOptions {
  readonly state?: DiagnosticState;
}

function toRange(document: vscode.TextDocument, range: DocumentDiagnostic["range"]): vscode.Range {
  return new vscode.Range(
    document.positionAt(range.start),
    document.positionAt(range.end)
  );
}

function toSeverity(level: DocumentDiagnostic["level"]): vscode.DiagnosticSeverity {
  if (level === "error") {
    return vscode.DiagnosticSeverity.Error;
  }
  if (level === "information") {
    return vscode.DiagnosticSeverity.Information;
  }
  return vscode.DiagnosticSeverity.Warning;
}

function convert(
  document: vscode.TextDocument,
  diagnostics: readonly DocumentDiagnostic[]
): readonly vscode.Diagnostic[] {
  return diagnostics.map((item) => {
    const diagnostic = new vscode.Diagnostic(toRange(document, item.range), item.message, toSeverity(item.level));
    diagnostic.source = "AVR Assembly IntelliSense";
    return diagnostic;
  });
}

function isSupported(document: vscode.TextDocument): boolean {
  return document.languageId === "avr-asm" && document.uri.scheme === "file";
}

function diagnosticsContext(state: DiagnosticState | undefined): DiagnosticsContext {
  if (state === undefined) {
    return {};
  }
  return {
    ...(state.resolveSymbol === undefined ? {} : { resolveSymbol: state.resolveSymbol }),
    ...(state.conditionalStateAt === undefined ? {} : {
      conditionalStateAt: state.conditionalStateAt
    })
  };
}

export function registerDiagnosticProviders(
  options: DiagnosticProviderOptions = {}
): readonly vscode.Disposable[] {
  const collection = vscode.languages.createDiagnosticCollection("avrAsmIntellisense");

  const refresh = (document: vscode.TextDocument): void => {
    if (!isSupported(document)) {
      collection.delete(document.uri);
      return;
    }
    const snapshot = createDocumentSnapshot(document.getText(), document.version);
    const diagnostics = buildDocumentDiagnostics(snapshot, diagnosticsContext(options.state));
    collection.set(document.uri, convert(document, diagnostics));
  };

  return Object.freeze([
    collection,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => {
      refresh(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      collection.delete(document.uri);
    })
  ]);
}
