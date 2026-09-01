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
}

export interface DocumentSnapshot {
  readonly version: number;
  readonly source: string;
  readonly lineStarts: readonly number[];
  readonly definitions: readonly LocalDefinition[];
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

function directiveKind(name: string): LocalDefinitionKind | undefined {
  switch (name) {
    case ".equ": return "equ";
    case ".equiv": return "equiv";
    case ".set": return "set";
    default: return undefined;
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
    || character === "$"
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
      lineComment = continuesPreprocessor;
      preprocessorLineComment = continuesPreprocessor;
      lineContinues = false;
      lineHasCode = false;
      quote = undefined;
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
    ...(expressionRange === undefined ? {} : { expressionRange })
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
  const definitionKind = directiveKind(normalizedBody);
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
    source.slice(bodySymbol.start, bodySymbol.end),
    "assignment",
    bodySymbol.start,
    bodySymbol.end,
    statementRange,
    frozenRange(expressionStart, codeEnd)
  ));
  return Object.freeze(definitions);
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
  const definitions = lines.flatMap((line) => parseDefinitionsOnLine(source, masked, line));
  return Object.freeze({
    version,
    source,
    lineStarts: Object.freeze(lines.map(({ start }) => start)),
    definitions: Object.freeze(definitions)
  });
}

export function findDefinitions(
  snapshot: DocumentSnapshot,
  name: string
): readonly LocalDefinition[] {
  return Object.freeze(snapshot.definitions.filter((definition) => definition.name === name));
}
