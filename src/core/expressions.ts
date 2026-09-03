import type { TextRange } from "./documentSnapshot";

export type ExpressionParseStatus = "complete" | "incomplete" | "invalid";
export type ExpressionUnaryOperator = "+" | "-" | "~";
export type ExpressionBinaryOperator =
  | "*" | "/" | "%" | "<<" | ">>"
  | "|" | "&" | "^" | "!"
  | "+" | "-"
  | "==" | "!=" | "<>" | "<" | ">" | "<=" | ">="
  | "&&" | "||";
export type AvrExpressionModifier =
  | "lo8" | "hi8" | "hlo8" | "hh8" | "hhi8"
  | "pm" | "gs" | "pm_lo8" | "pm_hi8" | "pm_hh8";

interface ExpressionBase {
  readonly range: TextRange;
}

export interface IntegerExpression extends ExpressionBase {
  readonly kind: "integer";
  readonly text: string;
}

export interface SymbolExpression extends ExpressionBase {
  readonly kind: "symbol";
  readonly name: string;
}

export interface NumericLabelReferenceExpression extends ExpressionBase {
  readonly kind: "numericLabelReference";
  readonly label: string;
  readonly direction: "forward" | "backward";
}

export interface LocationCounterExpression extends ExpressionBase {
  readonly kind: "locationCounter";
}

export interface UnaryExpression extends ExpressionBase {
  readonly kind: "unary";
  readonly operator: ExpressionUnaryOperator;
  readonly operatorRange: TextRange;
  readonly operand: ExpressionNode;
}

export interface BinaryExpression extends ExpressionBase {
  readonly kind: "binary";
  readonly operator: ExpressionBinaryOperator;
  readonly operatorRange: TextRange;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

export interface ParenthesizedExpression extends ExpressionBase {
  readonly kind: "parenthesized";
  readonly openRange: TextRange;
  readonly expression: ExpressionNode;
  readonly closeRange?: TextRange;
}

export interface AvrModifierExpression extends ExpressionBase {
  readonly kind: "avrModifier";
  readonly name: string;
  readonly normalizedName: AvrExpressionModifier;
  readonly nameRange: TextRange;
  readonly openRange: TextRange;
  readonly argument: ExpressionNode;
  readonly closeRange?: TextRange;
}

export interface MissingExpression extends ExpressionBase {
  readonly kind: "missing";
}

export interface UnknownExpression extends ExpressionBase {
  readonly kind: "unknown";
}

export type ExpressionNode =
  | IntegerExpression
  | SymbolExpression
  | NumericLabelReferenceExpression
  | LocationCounterExpression
  | UnaryExpression
  | BinaryExpression
  | ParenthesizedExpression
  | AvrModifierExpression
  | MissingExpression
  | UnknownExpression;

export interface ParsedExpression {
  readonly range: TextRange;
  readonly root: ExpressionNode;
  readonly status: ExpressionParseStatus;
  readonly remainderRange?: TextRange;
}

type TokenKind =
  | "integer"
  | "incompleteInteger"
  | "symbol"
  | "numericLabelReference"
  | "operator"
  | "leftParenthesis"
  | "rightParenthesis"
  | "unknown"
  | "end";

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly range: TextRange;
}

const MAX_EXPRESSION_DEPTH = 128;
const AVR_MODIFIERS: ReadonlySet<string> = new Set<AvrExpressionModifier>([
  "lo8", "hi8", "hlo8", "hh8", "hhi8", "pm", "gs", "pm_lo8", "pm_hi8", "pm_hh8"
]);
const DOUBLE_OPERATORS: ReadonlySet<string> = new Set([
  "<<", ">>", "==", "!=", "<>", ">=", "<=", "&&", "||"
]);
const SINGLE_OPERATORS: ReadonlySet<string> = new Set([
  "*", "/", "%", "|", "&", "^", "!", "+", "-", "~", "<", ">"
]);

function frozenRange(start: number, end: number): TextRange {
  return Object.freeze({ start, end });
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isHexDigit(character: string | undefined): boolean {
  return isDigit(character)
    || (character !== undefined && character.toLowerCase() >= "a"
      && character.toLowerCase() <= "f");
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
  return isSymbolStart(character) || isDigit(character);
}

function isWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\f"
    || character === "\v" || character === "\r" || character === "\n";
}

class ExpressionLexer {
  private cursor: number;

  public constructor(
    private readonly source: string,
    private readonly end: number,
    start: number
  ) {
    this.cursor = start;
  }

  public next(): Token {
    this.skipTrivia();
    const start = this.cursor;
    if (start >= this.end) {
      return this.token("end", start, start);
    }
    const character = this.characterAt(start);
    if (character === "'") {
      return this.characterConstant();
    }
    if (isDigit(character)) {
      return this.numberOrNumericLabel();
    }
    if (isSymbolStart(character)) {
      this.cursor += 1;
      while (isSymbolContinuation(this.characterAt(this.cursor))) {
        this.cursor += 1;
      }
      return this.token("symbol", start, this.cursor);
    }
    if (character === "(" || character === ")") {
      this.cursor += 1;
      return this.token(
        character === "(" ? "leftParenthesis" : "rightParenthesis",
        start,
        this.cursor
      );
    }
    const pair = this.source.slice(start, Math.min(start + 2, this.end));
    if (DOUBLE_OPERATORS.has(pair)) {
      this.cursor += 2;
      return this.token("operator", start, this.cursor);
    }
    if (character !== undefined && SINGLE_OPERATORS.has(character)) {
      this.cursor += 1;
      return this.token("operator", start, this.cursor);
    }
    this.cursor += 1;
    return this.token("unknown", start, this.cursor);
  }

  private numberOrNumericLabel(): Token {
    const start = this.cursor;
    if (this.characterAt(this.cursor) === "0"
      && (this.characterAt(this.cursor + 1) === "x"
        || this.characterAt(this.cursor + 1) === "X")) {
      this.cursor += 2;
      const digitStart = this.cursor;
      while (isHexDigit(this.characterAt(this.cursor))) {
        this.cursor += 1;
      }
      return this.token(
        this.cursor === digitStart ? "incompleteInteger" : "integer",
        start,
        this.cursor
      );
    }
    if (this.characterAt(this.cursor) === "0"
      && (this.characterAt(this.cursor + 1) === "b"
        || this.characterAt(this.cursor + 1) === "B")) {
      this.cursor += 2;
      const digitStart = this.cursor;
      while (this.characterAt(this.cursor) === "0" || this.characterAt(this.cursor) === "1") {
        this.cursor += 1;
      }
      return this.token(
        this.cursor === digitStart ? "incompleteInteger" : "integer",
        start,
        this.cursor
      );
    }
    while (isDigit(this.characterAt(this.cursor))) {
      this.cursor += 1;
    }
    const direction = this.characterAt(this.cursor);
    if ((direction === "f" || direction === "b")
      && !isSymbolContinuation(this.characterAt(this.cursor + 1))) {
      this.cursor += 1;
      return this.token("numericLabelReference", start, this.cursor);
    }
    return this.token("integer", start, this.cursor);
  }

  private characterConstant(): Token {
    const start = this.cursor;
    this.cursor += 1;
    if (this.characterAt(this.cursor) === "\\") {
      this.cursor += 1;
    }
    if (this.characterAt(this.cursor) === undefined) {
      return this.token("incompleteInteger", start, this.cursor);
    }
    this.cursor += 1;
    return this.token("integer", start, this.cursor);
  }

  private skipTrivia(): void {
    while (this.cursor < this.end) {
      if (isWhitespace(this.characterAt(this.cursor))) {
        this.cursor += 1;
        continue;
      }
      if (this.characterAt(this.cursor) === "\\") {
        const next = this.characterAt(this.cursor + 1);
        if (next === "\n") {
          this.cursor += 2;
          continue;
        }
        if (next === "\r") {
          this.cursor += this.characterAt(this.cursor + 2) === "\n" ? 3 : 2;
          continue;
        }
      }
      if (this.characterAt(this.cursor) === "/" && this.characterAt(this.cursor + 1) === "*") {
        const close = this.findBlockCommentClose(this.cursor + 2);
        this.cursor = close < 0 || close + 2 > this.end ? this.end : close + 2;
        continue;
      }
      break;
    }
  }

  private findBlockCommentClose(start: number): number {
    for (let cursor = start; cursor + 1 < this.end; cursor += 1) {
      if (this.characterAt(cursor) === "*" && this.characterAt(cursor + 1) === "/") {
        return cursor;
      }
    }
    return -1;
  }

  private token(kind: TokenKind, start: number, end: number): Token {
    return Object.freeze({
      kind,
      text: this.source.slice(start, end),
      range: frozenRange(start, end)
    });
  }

  private characterAt(offset: number): string | undefined {
    return offset >= this.end ? undefined : this.source[offset];
  }
}

function binaryPrecedence(operator: string): number | undefined {
  if (operator === "||") return 1;
  if (operator === "&&") return 2;
  if (["+", "-", "==", "!=", "<>", "<", ">", "<=", ">="].includes(operator)) return 3;
  if (["|", "&", "^", "!"].includes(operator)) return 4;
  if (["*", "/", "%", "<<", ">>"].includes(operator)) return 5;
  return undefined;
}

class ExpressionParser {
  private current: Token;
  private status: ExpressionParseStatus = "complete";

  public constructor(
    private readonly source: string,
    start: number,
    private readonly end: number
  ) {
    this.lexer = new ExpressionLexer(source, end, start);
    this.current = this.lexer.next();
  }

  private readonly lexer: ExpressionLexer;

  public parse(range: TextRange): ParsedExpression {
    const root = this.parseBinary(1, 0);
    let remainderRange: TextRange | undefined;
    if (this.current.kind !== "end") {
      this.markInvalid();
      remainderRange = frozenRange(this.current.range.start, this.end);
    }
    return Object.freeze({
      range,
      root,
      status: this.status,
      ...(remainderRange === undefined ? {} : { remainderRange })
    });
  }

  private parseBinary(minimumPrecedence: number, depth: number): ExpressionNode {
    let left = this.parsePrefix(depth);
    while (this.current.kind === "operator") {
      const precedence = binaryPrecedence(this.current.text);
      if (precedence === undefined || precedence < minimumPrecedence) {
        break;
      }
      const operator = this.consume();
      const right = this.parseBinary(precedence + 1, depth);
      left = Object.freeze({
        kind: "binary",
        operator: operator.text as ExpressionBinaryOperator,
        range: frozenRange(left.range.start, Math.max(operator.range.end, right.range.end)),
        operatorRange: operator.range,
        left,
        right
      });
    }
    return left;
  }

  private parsePrefix(depth: number): ExpressionNode {
    if (depth >= MAX_EXPRESSION_DEPTH) {
      this.markInvalid();
      return this.unknownOrMissing();
    }
    if (this.current.kind === "operator"
      && (this.current.text === "+" || this.current.text === "-" || this.current.text === "~")) {
      const operator = this.consume();
      const operand = this.parsePrefix(depth + 1);
      return Object.freeze({
        kind: "unary",
        operator: operator.text as ExpressionUnaryOperator,
        range: frozenRange(operator.range.start, Math.max(operator.range.end, operand.range.end)),
        operatorRange: operator.range,
        operand
      });
    }
    return this.parsePrimary(depth);
  }

  private parsePrimary(depth: number): ExpressionNode {
    const token = this.current;
    if (token.kind === "integer" || token.kind === "incompleteInteger") {
      if (token.kind === "incompleteInteger") {
        this.markIncomplete();
      }
      this.consume();
      return Object.freeze({ kind: "integer", text: token.text, range: token.range });
    }
    if (token.kind === "numericLabelReference") {
      this.consume();
      const suffix = token.text[token.text.length - 1];
      return Object.freeze({
        kind: "numericLabelReference",
        label: token.text.slice(0, -1),
        direction: suffix === "f" ? "forward" : "backward",
        range: token.range
      });
    }
    if (token.kind === "symbol") {
      this.consume();
      const normalizedName = token.text.toLowerCase();
      if (AVR_MODIFIERS.has(normalizedName) && this.current.kind === "leftParenthesis") {
        return this.parseModifier(token, normalizedName as AvrExpressionModifier, depth);
      }
      if (token.text === ".") {
        return Object.freeze({ kind: "locationCounter", range: token.range });
      }
      return Object.freeze({ kind: "symbol", name: token.text, range: token.range });
    }
    if (token.kind === "leftParenthesis") {
      return this.parseParenthesized(depth);
    }
    if (token.kind === "unknown") {
      this.markInvalid();
      this.consume();
      return Object.freeze({ kind: "unknown", range: token.range });
    }
    return this.missing(token.range.start);
  }

  private parseParenthesized(depth: number): ParenthesizedExpression {
    const open = this.consume();
    const expression = this.current.kind === "rightParenthesis" || this.current.kind === "end"
      ? this.missing(this.current.range.start)
      : this.parseBinary(1, depth + 1);
    const close = this.current.kind === "rightParenthesis" ? this.consume() : undefined;
    if (close === undefined) {
      this.markIncomplete();
    }
    return Object.freeze({
      kind: "parenthesized",
      range: frozenRange(open.range.start, close?.range.end ?? Math.max(open.range.end, expression.range.end)),
      openRange: open.range,
      expression,
      ...(close === undefined ? {} : { closeRange: close.range })
    });
  }

  private parseModifier(
    name: Token,
    normalizedName: AvrExpressionModifier,
    depth: number
  ): AvrModifierExpression {
    const open = this.consume();
    const argument = this.current.kind === "rightParenthesis" || this.current.kind === "end"
      ? this.missing(this.current.range.start)
      : this.parseBinary(1, depth + 1);
    const close = this.current.kind === "rightParenthesis" ? this.consume() : undefined;
    if (close === undefined) {
      this.markIncomplete();
    }
    return Object.freeze({
      kind: "avrModifier",
      name: name.text,
      normalizedName,
      range: frozenRange(name.range.start, close?.range.end ?? Math.max(open.range.end, argument.range.end)),
      nameRange: name.range,
      openRange: open.range,
      argument,
      ...(close === undefined ? {} : { closeRange: close.range })
    });
  }

  private unknownOrMissing(): ExpressionNode {
    if (this.current.kind === "end" || this.current.kind === "rightParenthesis") {
      return this.missing(this.current.range.start);
    }
    const token = this.consume();
    return Object.freeze({ kind: "unknown", range: token.range });
  }

  private missing(offset: number): MissingExpression {
    this.markIncomplete();
    return Object.freeze({ kind: "missing", range: frozenRange(offset, offset) });
  }

  private consume(): Token {
    const token = this.current;
    this.current = this.lexer.next();
    return token;
  }

  private markIncomplete(): void {
    if (this.status === "complete") {
      this.status = "incomplete";
    }
  }

  private markInvalid(): void {
    this.status = "invalid";
  }
}

export function parseExpression(source: string, range: TextRange): ParsedExpression {
  if (typeof source !== "string") {
    throw new TypeError("Expression source must be a string.");
  }
  if (typeof range !== "object" || range === null) {
    throw new TypeError("Expression range must be an object.");
  }
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) {
    throw new Error("Expression range must use integer offsets.");
  }
  if (range.start < 0 || range.end < range.start || range.end > source.length) {
    throw new Error("Expression range must be within the source.");
  }
  const immutableRange = frozenRange(range.start, range.end);
  return new ExpressionParser(source, range.start, range.end).parse(immutableRange);
}
