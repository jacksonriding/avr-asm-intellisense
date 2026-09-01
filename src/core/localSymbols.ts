import type {
  DocumentSnapshot,
  LocalDefinition,
  LocalDefinitionKind,
  TextRange
} from "./documentSnapshot";

export interface LocalSymbolCompletion {
  readonly label: string;
  readonly kind: LocalDefinitionKind;
  readonly detail: string;
  readonly definition: LocalDefinition;
}

export interface LocalDocumentSymbol {
  readonly name: string;
  readonly kind: LocalDefinitionKind;
  readonly detail: string;
  readonly range: TextRange;
  readonly selectionRange: TextRange;
  readonly definition: LocalDefinition;
}

export interface LocalSymbolHover {
  readonly name: string;
  readonly kind: LocalDefinitionKind;
  readonly range: TextRange;
  readonly detail: string;
  readonly definition: LocalDefinition;
  readonly expression?: string;
}

export interface LocalDefinitionTarget {
  readonly name: string;
  readonly kind: LocalDefinitionKind;
  readonly originSelectionRange: TextRange;
  readonly targetRange: TextRange;
  readonly targetSelectionRange: TextRange;
  readonly definition: LocalDefinition;
}

interface SourceToken {
  readonly text: string;
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly direction?: "forward" | "backward";
}

function frozenRange(start: number, end: number): TextRange {
  return Object.freeze({ start, end });
}

function completionDetail(kind: LocalDefinitionKind): string {
  switch (kind) {
    case "label": return "Label";
    case "localLabel": return "Local label";
    case "numericLabel": return "Numeric label";
    case "equ": return "Constant (.equ)";
    case "equiv": return "Constant (.equiv)";
    case "set": return "Mutable constant (.set)";
    case "assignment": return "Assignment";
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

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isSymbolContinuation(character: string | undefined): boolean {
  return isSymbolStart(character) || isDigit(character);
}

/** Replaces comments, strings, and preprocessor lines while retaining source offsets. */
function codeMask(source: string): string {
  const result = source.split("");
  let blockComment = false;
  let lineComment = false;
  let preprocessorLine = false;
  let preprocessorLastNonWhitespace: string | undefined;
  let lineHasCode = false;
  let quote: "\"" | "'" | undefined;
  let escaped = false;

  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    const next = source[cursor + 1];
    if (character === "\r" || character === "\n") {
      const continuedPreprocessor: boolean = preprocessorLine
        && preprocessorLastNonWhitespace === "\\";
      lineComment = continuedPreprocessor;
      preprocessorLine = continuedPreprocessor;
      preprocessorLastNonWhitespace = undefined;
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
      if (preprocessorLine && !isHorizontalWhitespace(character)) {
        preprocessorLastNonWhitespace = character;
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
      result[cursor] = " ";
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
      result[cursor] = " ";
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
      preprocessorLine = true;
      preprocessorLastNonWhitespace = character;
      continue;
    }
    if (!isHorizontalWhitespace(character)) {
      lineHasCode = true;
    }
  }
  return result.join("");
}

function tokenAtOffset(source: string, offset: number, existingMask?: string): SourceToken | undefined {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) {
    return undefined;
  }
  const masked = existingMask ?? codeMask(source);
  let cursor = 0;
  while (cursor < masked.length) {
    const start = cursor;
    if (isSymbolStart(masked[cursor])) {
      cursor += 1;
      while (cursor < masked.length && isSymbolContinuation(masked[cursor])) {
        cursor += 1;
      }
      if (offset >= start && offset <= cursor) {
        const text = source.slice(start, cursor);
        return Object.freeze({ text, name: text, start, end: cursor });
      }
      continue;
    }
    if (isDigit(masked[cursor])) {
      cursor += 1;
      while (cursor < masked.length && isDigit(masked[cursor])) {
        cursor += 1;
      }
      const digitsEnd = cursor;
      const suffix = masked[cursor];
      const directional = (suffix === "f" || suffix === "b")
        && !isSymbolContinuation(masked[cursor + 1]);
      if (directional) {
        cursor += 1;
      }
      if (offset >= start && offset <= cursor) {
        const text = source.slice(start, cursor);
        return Object.freeze({
          text,
          name: source.slice(start, digitsEnd),
          start,
          end: cursor,
          ...(directional ? { direction: suffix === "f" ? "forward" : "backward" } : {})
        });
      }
      continue;
    }
    cursor += 1;
  }
  return undefined;
}

function exactOccurrenceDefinition(
  definitions: readonly LocalDefinition[],
  token: SourceToken
): LocalDefinition | undefined {
  return definitions.find(({ nameRange }) => (
    nameRange.start === token.start && nameRange.end === token.end
  ));
}

function skipHorizontalWhitespace(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length && isHorizontalWhitespace(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function symbolEnd(source: string, start: number): number | undefined {
  if (isSymbolStart(source[start])) {
    let cursor = start + 1;
    while (cursor < source.length && isSymbolContinuation(source[cursor])) {
      cursor += 1;
    }
    return cursor;
  }
  if (isDigit(source[start])) {
    let cursor = start + 1;
    while (cursor < source.length && isDigit(source[cursor])) {
      cursor += 1;
    }
    return cursor;
  }
  return undefined;
}

function isStatementOperator(
  snapshot: DocumentSnapshot,
  token: SourceToken,
  masked: string
): boolean {
  if (exactOccurrenceDefinition(snapshot.definitions, token) !== undefined) {
    return false;
  }
  const lineFeed = masked.lastIndexOf("\n", Math.max(0, token.start - 1));
  const carriageReturn = masked.lastIndexOf("\r", Math.max(0, token.start - 1));
  let cursor = Math.max(lineFeed, carriageReturn) + 1;
  while (cursor <= token.start) {
    const candidateStart = skipHorizontalWhitespace(masked, cursor);
    const candidateEnd = symbolEnd(masked, candidateStart);
    if (candidateEnd === undefined) {
      return false;
    }
    const separator = skipHorizontalWhitespace(masked, candidateEnd);
    if (masked[separator] !== ":") {
      return candidateStart === token.start;
    }
    cursor = separator + 1;
  }
  return false;
}

function directionalDefinition(
  definitions: readonly LocalDefinition[],
  token: SourceToken
): LocalDefinition | undefined {
  const candidates = definitions.filter(({ name, kind }) => (
    kind === "numericLabel" && name === token.name
  ));
  if (token.direction === "forward") {
    return candidates.find(({ nameRange }) => nameRange.start > token.end);
  }
  if (token.direction === "backward") {
    return [...candidates].reverse().find(({ nameRange }) => nameRange.end < token.start);
  }
  return exactOccurrenceDefinition(candidates, token);
}

function namedHoverDefinition(
  definitions: readonly LocalDefinition[],
  token: SourceToken
): LocalDefinition | undefined {
  const candidates = definitions.filter(({ name, kind }) => (
    kind !== "numericLabel" && name === token.name
  ));
  const exact = exactOccurrenceDefinition(candidates, token);
  if (exact !== undefined) {
    return exact;
  }
  const preceding = [...candidates].reverse().find(({ nameRange }) => nameRange.start < token.start);
  return preceding ?? candidates[0];
}

function expressionText(snapshot: DocumentSnapshot, definition: LocalDefinition): string | undefined {
  const range = definition.expressionRange;
  return range === undefined ? undefined : snapshot.source.slice(range.start, range.end);
}

function hoverDetail(
  snapshot: DocumentSnapshot,
  definition: LocalDefinition
): { readonly detail: string; readonly expression?: string } {
  const expression = expressionText(snapshot, definition);
  const withExpression = (detail: string): {
    readonly detail: string;
    readonly expression?: string;
  } => Object.freeze({
    detail,
    ...(expression === undefined ? {} : { expression })
  });
  switch (definition.kind) {
    case "label": return Object.freeze({ detail: `Label: ${definition.name}` });
    case "localLabel": return Object.freeze({ detail: `Local label: ${definition.name}` });
    case "numericLabel": return Object.freeze({ detail: `Numeric label: ${definition.name}` });
    case "equ": return withExpression(`.equ ${definition.name} = ${expression ?? ""}`);
    case "equiv": return withExpression(`.equiv ${definition.name} = ${expression ?? ""}`);
    case "set": return withExpression(`.set ${definition.name} = ${expression ?? ""}`);
    case "assignment": return withExpression(`${definition.name} = ${expression ?? ""}`);
  }
}

export function localSymbolCompletions(
  snapshot: DocumentSnapshot,
  offset?: number
): readonly LocalSymbolCompletion[] {
  const seen = new Set<string>();
  const completions: LocalSymbolCompletion[] = [];
  for (const definition of snapshot.definitions) {
    if (definition.kind === "numericLabel" || seen.has(definition.name)) {
      continue;
    }
    seen.add(definition.name);
    completions.push(Object.freeze({
      label: definition.name,
      kind: definition.kind,
      detail: completionDetail(definition.kind),
      definition
    }));
  }
  if (offset === undefined || !Number.isSafeInteger(offset) || offset < 0
    || offset > snapshot.source.length) {
    return Object.freeze(completions);
  }

  const numericOrder: string[] = [];
  const numericTargets = new Map<string, LocalDefinition>();
  for (const definition of snapshot.definitions) {
    if (definition.kind !== "numericLabel") {
      continue;
    }
    const direction = definition.nameRange.start < offset ? "b"
      : definition.nameRange.start > offset ? "f"
        : undefined;
    if (direction === undefined) {
      continue;
    }
    const label = `${definition.name}${direction}`;
    if (!numericTargets.has(label)) {
      numericOrder.push(label);
    }
    if (direction === "b" || !numericTargets.has(label)) {
      numericTargets.set(label, definition);
    }
  }
  const numericCompletions = numericOrder.flatMap((label): readonly LocalSymbolCompletion[] => {
    const definition = numericTargets.get(label);
    if (definition === undefined) {
      return Object.freeze([]);
    }
    return Object.freeze([Object.freeze({
      label,
      kind: definition.kind,
      detail: label.endsWith("b") ? "Numeric label (backward)" : "Numeric label (forward)",
      definition
    })]);
  });
  return Object.freeze([...completions, ...numericCompletions]);
}

export function localDocumentSymbols(
  snapshot: DocumentSnapshot
): readonly LocalDocumentSymbol[] {
  return Object.freeze(snapshot.definitions.map((definition) => Object.freeze({
    name: definition.name,
    kind: definition.kind,
    detail: completionDetail(definition.kind),
    range: frozenRange(definition.statementRange.start, definition.statementRange.end),
    selectionRange: frozenRange(definition.nameRange.start, definition.nameRange.end),
    definition
  })));
}

export function localSymbolHover(
  snapshot: DocumentSnapshot,
  offset: number
): LocalSymbolHover | undefined {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > snapshot.source.length) {
    return undefined;
  }
  const masked = codeMask(snapshot.source);
  const token = tokenAtOffset(snapshot.source, offset, masked);
  if (token === undefined) {
    return undefined;
  }
  if (isStatementOperator(snapshot, token, masked)) {
    return undefined;
  }
  const definition = token.direction !== undefined || isDigit(token.text[0])
    ? directionalDefinition(snapshot.definitions, token)
    : namedHoverDefinition(snapshot.definitions, token);
  if (definition === undefined) {
    return undefined;
  }
  const presentation = hoverDetail(snapshot, definition);
  return Object.freeze({
    name: definition.name,
    kind: definition.kind,
    range: frozenRange(token.start, token.end),
    detail: presentation.detail,
    definition,
    ...(presentation.expression === undefined ? {} : { expression: presentation.expression })
  });
}

function frozenTarget(token: SourceToken, definition: LocalDefinition): LocalDefinitionTarget {
  return Object.freeze({
    name: definition.name,
    kind: definition.kind,
    originSelectionRange: frozenRange(token.start, token.end),
    targetRange: frozenRange(definition.statementRange.start, definition.statementRange.end),
    targetSelectionRange: frozenRange(definition.nameRange.start, definition.nameRange.end),
    definition
  });
}

export function localDefinitionTargets(
  snapshot: DocumentSnapshot,
  offset: number
): readonly LocalDefinitionTarget[] {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > snapshot.source.length) {
    return Object.freeze([]);
  }
  const masked = codeMask(snapshot.source);
  const token = tokenAtOffset(snapshot.source, offset, masked);
  if (token === undefined) {
    return Object.freeze([]);
  }
  if (isStatementOperator(snapshot, token, masked)) {
    return Object.freeze([]);
  }
  if (token.direction !== undefined) {
    const definition = directionalDefinition(snapshot.definitions, token);
    return definition === undefined
      ? Object.freeze([])
      : Object.freeze([frozenTarget(token, definition)]);
  }
  if (isDigit(token.text[0])) {
    const definition = directionalDefinition(snapshot.definitions, token);
    return definition === undefined
      ? Object.freeze([])
      : Object.freeze([frozenTarget(token, definition)]);
  }
  return Object.freeze(snapshot.definitions
    .filter(({ name, kind }) => kind !== "numericLabel" && name === token.name)
    .map((definition) => frozenTarget(token, definition)));
}
