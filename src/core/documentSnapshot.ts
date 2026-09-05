import { findInstruction } from "./instructions";
import { parseExpression, type ParsedExpression } from "./expressions";

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export type LocalDefinitionKind =
  | "label"
  | "localLabel"
  | "numericLabel"
  | "equ"
  | "equiv"
  | "set"
  | "assignment";

export interface LocalDefinition {
  readonly name: string;
  readonly kind: LocalDefinitionKind;
  readonly nameRange: TextRange;
  readonly statementRange: TextRange;
  readonly expressionRange?: TextRange;
  readonly expression?: ParsedExpression;
}

export type DocumentStatementKind =
  | "instruction"
  | "directive"
  | "directiveBlockElse"
  | "directiveBlockEnd"
  | "directiveBlockStart"
  | "macroInvocation";

export interface StatementOperand {
  readonly text: string;
  readonly range: TextRange;
  readonly missing: boolean;
  readonly expression?: ParsedExpression;
}

export interface DocumentStatement {
  readonly kind: DocumentStatementKind;
  readonly name: string;
  readonly normalizedName: string;
  readonly range: TextRange;
  readonly nameRange: TextRange;
  readonly operands: readonly StatementOperand[];
}

export interface DocumentSnapshot {
  readonly version: number;
  readonly source: string;
  readonly lineStarts: readonly number[];
  readonly definitions: readonly LocalDefinition[];
  readonly statements: readonly DocumentStatement[];
}

interface SourceLine {
  readonly start: number;
  readonly end: number;
}

interface ParsedSymbol {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

function frozenRange(start: number, end: number): TextRange {
  return Object.freeze({ start, end });
}

function definitionDirectiveKind(name: string): LocalDefinitionKind | undefined {
  switch (name) {
    case ".equ": return "equ";
    case ".equiv": return "equiv";
    case ".set": return "set";
    default: return undefined;
  }
}

function directiveStatementKind(name: string): DocumentStatementKind | undefined {
  switch (name) {
    case ".macro":
    case ".rept":
    case ".irp":
    case ".irpc":
    case ".if":
    case ".ifdef":
    case ".ifndef":
      return "directiveBlockStart";
    case ".else":
    case ".elif":
      return "directiveBlockElse";
    case ".endm":
    case ".endr":
    case ".endif":
      return "directiveBlockEnd";
    default:
      return undefined;
  }
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\f" || character === "\v";
}

function isSymbolStart(character: string | undefined): boolean {
  return character !== undefined && (
    (character >= "A" && character <= "Z")
    || (character >= "a" && character <= "z")
    || character === "_"
    || character === "."
  );
}

function isSymbolContinuation(character: string | undefined): boolean {
  return isSymbolStart(character) || (
    character !== undefined && character >= "0" && character <= "9"
  );
}

function skipHorizontalWhitespace(source: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end && isHorizontalWhitespace(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function trimHorizontalWhitespace(source: string, start: number, end: number): number {
  let cursor = end;
  while (cursor > start && isHorizontalWhitespace(source[cursor - 1])) {
    cursor -= 1;
  }
  return cursor;
}

function parseNamedSymbol(source: string, start: number, end: number): ParsedSymbol | undefined {
  if (!isSymbolStart(source[start])) {
    return undefined;
  }
  let cursor = start + 1;
  while (cursor < end && isSymbolContinuation(source[cursor])) {
    cursor += 1;
  }
  return Object.freeze({ name: source.slice(start, cursor), start, end: cursor });
}

function parseLabelSymbol(source: string, start: number, end: number): ParsedSymbol | undefined {
  if (isSymbolStart(source[start])) {
    return parseNamedSymbol(source, start, end);
  }
  const first = source[start];
  if (first === undefined || first < "0" || first > "9") {
    return undefined;
  }
  let cursor = start + 1;
  while (cursor < end) {
    const character = source[cursor];
    if (character === undefined || character < "0" || character > "9") {
      break;
    }
    cursor += 1;
  }
  return Object.freeze({ name: source.slice(start, cursor), start, end: cursor });
}

function physicalLines(source: string): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let lineStart = 0;
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character !== "\r" && character !== "\n") {
      continue;
    }
    lines.push(Object.freeze({ start: lineStart, end: cursor }));
    if (character === "\r" && source[cursor + 1] === "\n") {
      cursor += 1;
    }
    lineStart = cursor + 1;
  }
  lines.push(Object.freeze({ start: lineStart, end: source.length }));
  return Object.freeze(lines);
}

function maskedComments(source: string): string {
  const result = source.split("");
  let blockComment = false;
  let lineComment = false;
  let preprocessorLineComment = false;
  let lineContinues = false;
  let lineHasCode = false;
  let quote: "\"" | "'" | undefined;
  let escaped = false;

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    const next = source[cursor + 1];
    if (character === "\r" || character === "\n") {
      const continuesPreprocessor: boolean = preprocessorLineComment && lineContinues;
      const continuedQuote = quote !== undefined && escaped ? quote : undefined;
      lineComment = continuesPreprocessor;
      preprocessorLineComment = continuesPreprocessor;
      lineContinues = false;
      lineHasCode = false;
      quote = continuedQuote;
      escaped = false;
      if (character === "\r" && next === "\n") {
        cursor += 1;
      }
      continue;
    }
    if (lineComment) {
      result[cursor] = " ";
      if (preprocessorLineComment && !isHorizontalWhitespace(character)) {
        lineContinues = character === "\\";
      }
      continue;
    }
    if (blockComment) {
      result[cursor] = " ";
      if (character === "*" && next === "/") {
        result[cursor + 1] = " ";
        cursor += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      lineHasCode = true;
      continue;
    }
    if (character === ";" || (character === "/" && next === "/")) {
      result[cursor] = " ";
      if (next === "/") {
        result[cursor + 1] = " ";
        cursor += 1;
      }
      lineComment = true;
      preprocessorLineComment = false;
      lineContinues = false;
      continue;
    }
    if (character === "/" && next === "*") {
      result[cursor] = " ";
      result[cursor + 1] = " ";
      cursor += 1;
      blockComment = true;
      continue;
    }
    if (character === "#" && !lineHasCode) {
      result[cursor] = " ";
      lineComment = true;
      preprocessorLineComment = true;
      lineContinues = false;
      continue;
    }
    if (!isHorizontalWhitespace(character)) {
      lineHasCode = true;
    }
  }
  return result.join("");
}

function logicalLines(lines: readonly SourceLine[], masked: string): readonly SourceLine[] {
  const logical: SourceLine[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const first = lines[lineIndex]!;
    let last = first;
    while (last.end > last.start
      && masked[last.end - 1] === "\\"
      && lineIndex + 1 < lines.length) {
      lineIndex += 1;
      last = lines[lineIndex]!;
    }
    logical.push(Object.freeze({ start: first.start, end: last.end }));
  }
  return Object.freeze(logical);
}

function matchingDelimiter(opening: string, closing: string): boolean {
  return (opening === "(" && closing === ")")
    || (opening === "[" && closing === "]")
    || (opening === "{" && closing === "}");
}

function topLevelStatementRanges(masked: string, logicalLine: SourceLine): readonly SourceLine[] {
  const ranges: SourceLine[] = [];
  const delimiters: string[] = [];
  let start = logicalLine.start;
  let quote: "\"" | "'" | undefined;
  let escaped = false;

  for (let cursor = logicalLine.start; cursor < logicalLine.end; cursor += 1) {
    const character = masked[cursor];
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      delimiters.push(character);
    } else if (character === ")" || character === "]" || character === "}") {
      const opening = delimiters[delimiters.length - 1];
      if (opening !== undefined && matchingDelimiter(opening, character)) {
        delimiters.pop();
      }
    } else if (character === "$" && delimiters.length === 0) {
      const rangeStart = skipHorizontalWhitespace(masked, start, cursor);
      const rangeEnd = trimHorizontalWhitespace(masked, rangeStart, cursor);
      if (rangeStart < rangeEnd) {
        ranges.push(Object.freeze({ start: rangeStart, end: rangeEnd }));
      }
      start = cursor + 1;
    }
  }
  const rangeStart = skipHorizontalWhitespace(masked, start, logicalLine.end);
  const rangeEnd = trimHorizontalWhitespace(masked, rangeStart, logicalLine.end);
  if (rangeStart < rangeEnd) {
    ranges.push(Object.freeze({ start: rangeStart, end: rangeEnd }));
  }
  return Object.freeze(ranges);
}

function statementRanges(lines: readonly SourceLine[], masked: string): readonly SourceLine[] {
  return Object.freeze(logicalLines(lines, masked).flatMap(
    (line) => topLevelStatementRanges(masked, line)
  ));
}

function expressionHasTerminatedStrings(source: string, start: number, end: number): boolean {
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  for (let cursor = start; cursor < end; cursor += 1) {
    const character = source[cursor];
    if (quote === undefined) {
      if (character === "\"" || character === "'") {
        quote = character;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === quote) {
      quote = undefined;
    }
  }
  return quote === undefined;
}

function frozenDefinition(
  source: string,
  name: string,
  kind: LocalDefinitionKind,
  nameStart: number,
  nameEnd: number,
  statementRange: TextRange,
  expressionRange?: TextRange
): LocalDefinition {
  return Object.freeze({
    name,
    kind,
    nameRange: frozenRange(nameStart, nameEnd),
    statementRange,
    ...(expressionRange === undefined ? {} : {
      expressionRange,
      expression: parseExpression(source, expressionRange)
    })
  });
}

function labelKind(name: string): LocalDefinitionKind {
  if (name[0] !== undefined && name[0] >= "0" && name[0] <= "9") {
    return "numericLabel";
  }
  return name.startsWith(".L") ? "localLabel" : "label";
}

function parseDefinitionsOnLine(
  source: string,
  masked: string,
  line: SourceLine
): readonly LocalDefinition[] {
  const definitions: LocalDefinition[] = [];
  const codeStart = skipHorizontalWhitespace(masked, line.start, line.end);
  const codeEnd = trimHorizontalWhitespace(masked, codeStart, line.end);
  if (codeStart >= codeEnd) {
    return Object.freeze(definitions);
  }
  const statementRange = frozenRange(codeStart, codeEnd);
  let cursor = codeStart;

  while (cursor < codeEnd) {
    const symbolStart = skipHorizontalWhitespace(masked, cursor, codeEnd);
    const symbol = parseLabelSymbol(masked, symbolStart, codeEnd);
    if (symbol === undefined) {
      break;
    }
    const colon = skipHorizontalWhitespace(masked, symbol.end, codeEnd);
    if (masked[colon] !== ":") {
      break;
    }
    const name = source.slice(symbol.start, symbol.end);
    definitions.push(frozenDefinition(
      source,
      name,
      labelKind(name),
      symbol.start,
      symbol.end,
      statementRange
    ));
    cursor = colon + 1;
  }

  const bodyStart = skipHorizontalWhitespace(masked, cursor, codeEnd);
  const bodySymbol = parseNamedSymbol(masked, bodyStart, codeEnd);
  if (bodySymbol === undefined) {
    return Object.freeze(definitions);
  }
  const normalizedBody = bodySymbol.name.toLowerCase();
  const definitionKind = definitionDirectiveKind(normalizedBody);
  if (definitionKind !== undefined) {
    const nameStart = skipHorizontalWhitespace(masked, bodySymbol.end, codeEnd);
    const name = parseNamedSymbol(masked, nameStart, codeEnd);
    if (name === undefined) {
      return Object.freeze(definitions);
    }
    const comma = skipHorizontalWhitespace(masked, name.end, codeEnd);
    if (masked[comma] !== ",") {
      return Object.freeze(definitions);
    }
    const expressionStart = skipHorizontalWhitespace(masked, comma + 1, codeEnd);
    if (expressionStart >= codeEnd
      || !expressionHasTerminatedStrings(masked, expressionStart, codeEnd)) {
      return Object.freeze(definitions);
    }
    definitions.push(frozenDefinition(
      source,
      source.slice(name.start, name.end),
      definitionKind,
      name.start,
      name.end,
      statementRange,
      frozenRange(expressionStart, codeEnd)
    ));
    return Object.freeze(definitions);
  }

  const equals = skipHorizontalWhitespace(masked, bodySymbol.end, codeEnd);
  if (masked[equals] !== "=" || masked[equals + 1] === "=") {
    return Object.freeze(definitions);
  }
  const expressionStart = skipHorizontalWhitespace(masked, equals + 1, codeEnd);
  if (expressionStart >= codeEnd
    || !expressionHasTerminatedStrings(masked, expressionStart, codeEnd)) {
    return Object.freeze(definitions);
  }
  definitions.push(frozenDefinition(
    source,
    source.slice(bodySymbol.start, bodySymbol.end),
    "assignment",
    bodySymbol.start,
    bodySymbol.end,
    statementRange,
    frozenRange(expressionStart, codeEnd)
  ));
  return Object.freeze(definitions);
}

function skipOperandTrivia(source: string, start: number, end: number): number {
  let cursor = skipHorizontalWhitespace(source, start, end);
  while (cursor < end && source[cursor] === "\\") {
    const next = source[cursor + 1];
    const afterNewline = next === "\n"
      ? cursor + 2
      : (next === "\r"
        ? (source[cursor + 2] === "\n" ? cursor + 3 : cursor + 2)
        : undefined);
    if (afterNewline === undefined) {
      break;
    }
    cursor = skipHorizontalWhitespace(source, afterNewline, end);
  }
  return cursor;
}

function frozenOperand(
  source: string,
  start: number,
  end: number
): StatementOperand {
  const trimmedStart = skipOperandTrivia(source, start, end);
  const trimmedEnd = trimHorizontalWhitespace(source, trimmedStart, end);
  const missing = trimmedStart >= trimmedEnd;
  const range = missing
    ? frozenRange(end, end)
    : frozenRange(trimmedStart, trimmedEnd);
  return Object.freeze({
    text: missing ? "" : source.slice(range.start, range.end),
    range,
    missing,
    ...(missing ? {} : { expression: parseExpression(source, range) })
  });
}

function splitStatementOperands(
  source: string,
  masked: string,
  start: number,
  end: number,
  splitWhitespace: boolean
): readonly StatementOperand[] {
  const operandStart = skipOperandTrivia(source, start, end);
  if (operandStart >= end) {
    return Object.freeze([]);
  }

  const operands: StatementOperand[] = [];
  const delimiters: string[] = [];
  let segmentStart = operandStart;
  let quote: "\"" | "'" | undefined;
  let escaped = false;

  for (let cursor = operandStart; cursor < end; cursor += 1) {
    const character = masked[cursor];
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (source[cursor] === "/" && source[cursor + 1] === "*" && character === " ") {
      const commentEnd = source.indexOf("*/", cursor + 2);
      cursor = commentEnd < 0 || commentEnd >= end ? end - 1 : commentEnd + 1;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "(" || character === "[" || character === "{") {
      delimiters.push(character);
    } else if (character === ")" || character === "]" || character === "}") {
      const opening = delimiters[delimiters.length - 1];
      if (opening !== undefined && matchingDelimiter(opening, character)) {
        delimiters.pop();
      }
    } else if (character === "," && delimiters.length === 0) {
      operands.push(frozenOperand(source, segmentStart, cursor));
      segmentStart = cursor + 1;
    } else if (splitWhitespace
      && delimiters.length === 0
      && isHorizontalWhitespace(source[cursor])) {
      const nextToken = skipHorizontalWhitespace(source, cursor + 1, end);
      if (masked[nextToken] === ",") {
        cursor = nextToken - 1;
        continue;
      }
      const operand = frozenOperand(source, segmentStart, cursor);
      if (!operand.missing) {
        operands.push(operand);
      }
      segmentStart = nextToken;
      cursor = segmentStart - 1;
    }
  }

  const finalOperand = frozenOperand(source, segmentStart, end);
  if (!finalOperand.missing || operands.length > 0 || segmentStart > operandStart) {
    operands.push(finalOperand);
  }
  return Object.freeze(operands);
}

function parseStatementOnLine(
  source: string,
  masked: string,
  line: SourceLine
): DocumentStatement | undefined {
  const codeStart = skipHorizontalWhitespace(masked, line.start, line.end);
  const codeEnd = trimHorizontalWhitespace(masked, codeStart, line.end);
  if (codeStart >= codeEnd) {
    return undefined;
  }
  let cursor = codeStart;
  while (cursor < codeEnd) {
    const symbolStart = skipHorizontalWhitespace(masked, cursor, codeEnd);
    const symbol = parseLabelSymbol(masked, symbolStart, codeEnd);
    if (symbol === undefined) {
      break;
    }
    const colon = skipHorizontalWhitespace(masked, symbol.end, codeEnd);
    if (masked[colon] !== ":") {
      break;
    }
    cursor = colon + 1;
  }

  const nameStart = skipHorizontalWhitespace(masked, cursor, codeEnd);
  const symbol = parseNamedSymbol(masked, nameStart, codeEnd);
  if (symbol === undefined) {
    return undefined;
  }
  const afterName = skipHorizontalWhitespace(masked, symbol.end, codeEnd);
  if (masked[afterName] === "=" && masked[afterName + 1] !== "=") {
    return undefined;
  }

  const name = source.slice(symbol.start, symbol.end);
  const instruction = findInstruction(name);
  const isDirective = name.startsWith(".");
  const normalizedName = instruction?.mnemonic ?? (isDirective ? name.toLowerCase() : name);
  const blockKind = isDirective ? directiveStatementKind(normalizedName) : undefined;
  const kind: DocumentStatementKind = instruction !== undefined
    ? "instruction"
    : (blockKind ?? (isDirective ? "directive" : "macroInvocation"));
  return Object.freeze({
    kind,
    name,
    normalizedName,
    range: frozenRange(codeStart, codeEnd),
    nameRange: frozenRange(symbol.start, symbol.end),
    operands: splitStatementOperands(
      source,
      masked,
      symbol.end,
      codeEnd,
      kind === "macroInvocation"
    )
  });
}

export function createDocumentSnapshot(source: string, version: number): DocumentSnapshot {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error("Document version must be a non-negative integer.");
  }
  if (typeof source !== "string") {
    throw new TypeError("Document source must be a string.");
  }
  const lines = physicalLines(source);
  const masked = maskedComments(source);
  const ranges = statementRanges(lines, masked);
  const definitions = ranges.flatMap((line) => parseDefinitionsOnLine(source, masked, line));
  const statements = ranges.flatMap((line) => {
    const statement = parseStatementOnLine(source, masked, line);
    return statement === undefined ? [] : [statement];
  });
  return Object.freeze({
    version,
    source,
    lineStarts: Object.freeze(lines.map(({ start }) => start)),
    definitions: Object.freeze(definitions),
    statements: Object.freeze(statements)
  });
}

export function findDefinitions(
  snapshot: DocumentSnapshot,
  name: string
): readonly LocalDefinition[] {
  return Object.freeze(snapshot.definitions.filter((definition) => definition.name === name));
}
