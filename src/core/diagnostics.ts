import { findInstruction } from "./instructions";
import type { ParsedExpression, type ExpressionNode } from "./expressions";
import type { DocumentSnapshot, TextRange } from "./documentSnapshot";

export type DiagnosticLevel = "error" | "warning" | "information";
export type ConditionalState = "active" | "inactive" | "unknown";

export interface DiagnosticsContext {
  readonly resolveSymbol?: (name: string) => boolean;
  readonly conditionalStateAt?: (offset: number) => ConditionalState;
}

export interface DocumentDiagnostic {
  readonly range: TextRange;
  readonly message: string;
  readonly level: DiagnosticLevel;
}

function isRegisterLikeSymbol(name: string): boolean {
  const match = name.toLowerCase().match(/^r(\d{1,2})$/u);
  if (match === null) {
    return false;
  }
  const index = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(index) && index >= 0 && index <= 31;
}

function isActive(
  context: DiagnosticsContext | undefined,
  offset: number
): boolean {
  if (context?.conditionalStateAt === undefined) {
    return true;
  }
  return context.conditionalStateAt(offset) !== "inactive";
}

function isKnownSymbol(
  context: DiagnosticsContext | undefined,
  localSymbols: Set<string>,
  name: string
): boolean {
  if (localSymbols.has(name)) {
    return true;
  }
  return context?.resolveSymbol?.(name) ?? false;
}

function collectSymbolReferences(
  expression: ParsedExpression
): readonly { readonly name: string; readonly range: TextRange }[] {
  const symbols: { readonly name: string; readonly range: TextRange }[] = [];
  const visit = (node: ExpressionNode): void => {
    if (node.kind === "symbol") {
      symbols.push({ name: node.name, range: node.range });
      return;
    }
    if (node.kind === "unary") {
      visit(node.operand);
      return;
    }
    if (node.kind === "binary") {
      visit(node.left);
      visit(node.right);
      return;
    }
    if (node.kind === "parenthesized") {
      visit(node.expression);
      return;
    }
    if (node.kind === "avrModifier") {
      visit(node.argument);
    }
  };

  if (expression.root.kind === "missing") {
    return Object.freeze(symbols);
  }
  visit(expression.root);
  return Object.freeze(symbols);
}

function emitIf(
  diagnostics: DocumentDiagnostic[],
  range: TextRange,
  message: string,
  level: DiagnosticLevel,
  dedupeKey: string,
  seen: Set<string>
): void {
  if (seen.has(dedupeKey)) {
    return;
  }
  seen.add(dedupeKey);
  diagnostics.push(Object.freeze({
    range,
    message,
    level
  }));
}

export function buildDocumentDiagnostics(
  snapshot: DocumentSnapshot,
  context: DiagnosticsContext = {}
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  const dedupe = new Set<string>();
  const localSymbols = new Set(snapshot.definitions.map(({ name }) => name));

  for (const statement of snapshot.statements) {
    if (!isActive(context, statement.range.start)) {
      continue;
    }

    if (statement.kind === "instruction") {
      const instruction = findInstruction(statement.name);
      if (instruction !== undefined) {
        const operandCount = statement.operands.filter((operand) => !operand.missing).length;
        const validCounts = [...new Set(instruction.forms.map(({ operands }) => operands.length))]
          .sort((left, right) => left - right);
        if (!validCounts.includes(operandCount)) {
          const expected = validCounts.length === 1
            ? `${validCounts[0]}`
            : `${validCounts[0]} or ${validCounts[validCounts.length - 1]}`;
          emitIf(
            diagnostics,
            statement.nameRange,
            `${instruction.mnemonic} expects ${expected} operand${expected === "1" ? "" : "s"} but got ${operandCount}.`,
            "warning",
            `${statement.nameRange.start}-${statement.nameRange.end}:operand-count:${statement.name}`,
            dedupe
          );
        }

        for (let index = 0; index < statement.operands.length; index += 1) {
          const operand = statement.operands[index];
          if (operand.expression === undefined || !isActive(context, operand.range.start)) {
            continue;
          }
          if (operand.expression.status === "invalid") {
            emitIf(
              diagnostics,
              operand.range,
              `Malformed expression in operand ${index + 1} of ${instruction.mnemonic}.`,
              "error",
              `${operand.range.start}-${operand.range.end}:invalid-expression:${statement.name}:${index}`,
              dedupe
            );
            continue;
          }
          if (operand.expression.status === "incomplete") {
            emitIf(
              diagnostics,
              operand.range,
              `Incomplete expression in operand ${index + 1} of ${instruction.mnemonic}.`,
              "information",
              `${operand.range.start}-${operand.range.end}:incomplete-expression:${statement.name}:${index}`,
              dedupe
            );
          }
          if (context.resolveSymbol === undefined) {
            continue;
          }
          for (const reference of collectSymbolReferences(operand.expression)) {
            const name = reference.name;
            if (isRegisterLikeSymbol(name) || isKnownSymbol(context, localSymbols, name)) {
              continue;
            }
            emitIf(
              diagnostics,
              reference.range,
              `Undefined symbol reference '${name}'.`,
              "warning",
              `${reference.range.start}-${reference.range.end}:undefined-symbol:${name}`,
              dedupe
            );
          }
        }
      }
      continue;
    }

    if (statement.kind === "directive") {
      if (statement.operands.some((operand) => (
        operand.expression?.status === "invalid"
      ))) {
        emitIf(
          diagnostics,
          statement.nameRange,
          `Unresolved expression in ${statement.name} directive.`,
          "warning",
          `${statement.nameRange.start}-${statement.nameRange.end}:directive-expression:${statement.name}`,
          dedupe
        );
      }
    }
  }

  return Object.freeze(diagnostics);
}
