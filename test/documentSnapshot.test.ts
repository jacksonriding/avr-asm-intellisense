import { describe, expect, it } from "vitest";

import {
  createDocumentSnapshot,
  findDefinitions,
  type DocumentSnapshot,
  type DocumentStatement,
  type LocalDefinition
} from "../src/core/documentSnapshot";

function definitionSummary(snapshot: DocumentSnapshot) {
  return snapshot.definitions.map(({ name, kind }) => ({ name, kind }));
}

function expectFrozenDefinition(definition: LocalDefinition): void {
  expect(Object.isFrozen(definition)).toBe(true);
  expect(Object.isFrozen(definition.nameRange)).toBe(true);
  expect(Object.isFrozen(definition.statementRange)).toBe(true);
  if (definition.expressionRange !== undefined) {
    expect(Object.isFrozen(definition.expressionRange)).toBe(true);
  }
}

function statementSource(source: string, statement: DocumentStatement): string {
  return source.slice(statement.range.start, statement.range.end);
}

function operandSources(source: string, statement: DocumentStatement): readonly string[] {
  return statement.operands.map(({ range }) => source.slice(range.start, range.end));
}

describe("document snapshots", () => {
  it("classifies source-spelled operators after labels and preserves absolute ranges", () => {
    const source = [
      "  reset: again: LdI r16, 0x2a ; setup",
      "\t.BYTE 1, 2",
      "customMacro r18",
      "nop"
    ].join("\n");

    const snapshot = createDocumentSnapshot(source, 3);

    expect(snapshot.statements.map((statement) => ({
      kind: statement.kind,
      name: statement.name,
      normalizedName: statement.normalizedName,
      source: statementSource(source, statement),
      operator: source.slice(statement.nameRange.start, statement.nameRange.end),
      operands: operandSources(source, statement)
    }))).toEqual([
      {
        kind: "instruction",
        name: "LdI",
        normalizedName: "LDI",
        source: "reset: again: LdI r16, 0x2a",
        operator: "LdI",
        operands: ["r16", "0x2a"]
      },
      {
        kind: "directive",
        name: ".BYTE",
        normalizedName: ".byte",
        source: ".BYTE 1, 2",
        operator: ".BYTE",
        operands: ["1", "2"]
      },
      {
        kind: "macroInvocation",
        name: "customMacro",
        normalizedName: "customMacro",
        source: "customMacro r18",
        operator: "customMacro",
        operands: ["r18"]
      },
      {
        kind: "instruction",
        name: "nop",
        normalizedName: "NOP",
        source: "nop",
        operator: "nop",
        operands: []
      }
    ]);
  });

  it("splits only top-level operands across balanced syntax, quotes, escapes, and comments", () => {
    const source = [
      "macro (r16, r17), [Z, 4], {1, 2}, \"a,\\\"b\", 'c,', first/*,*/,last",
      ".ascii \"semi; slash// block/*,*/\", tail // ignored"
    ].join("\n");

    const snapshot = createDocumentSnapshot(source, 0);

    expect(snapshot.statements).toHaveLength(2);
    expect(operandSources(source, snapshot.statements[0]!)).toEqual([
      "(r16, r17)",
      "[Z, 4]",
      "{1, 2}",
      "\"a,\\\"b\"",
      "'c,'",
      "first/*,*/",
      "last"
    ]);
    expect(operandSources(source, snapshot.statements[1]!)).toEqual([
      "\"semi; slash// block/*,*/\"",
      "tail"
    ]);
  });

  it("splits macro arguments on top-level blanks or commas only", () => {
    const source = "macro r16 r17 , (one two), [Z + 4] \"quoted value\"";
    const statement = createDocumentSnapshot(source, 0).statements[0]!;

    expect(statement.kind).toBe("macroInvocation");
    expect(operandSources(source, statement)).toEqual([
      "r16",
      "r17",
      "(one two)",
      "[Z + 4]",
      "\"quoted value\""
    ]);
  });

  it("parses top-level dollar-separated statements independently", () => {
    const source = "  ldi r16, 1 $ rjmp target $ .byte 2  ";
    const snapshot = createDocumentSnapshot(source, 0);

    expect(snapshot.statements.map((statement) => statementSource(source, statement)))
      .toEqual(["ldi r16, 1", "rjmp target", ".byte 2"]);
    expect(snapshot.statements.map(({ normalizedName }) => normalizedName))
      .toEqual(["LDI", "RJMP", ".byte"]);
  });

  it("treats dollar as a separator rather than a symbol character in the default AVR profile", () => {
    const snapshot = createDocumentSnapshot("first$target: nop", 0);

    expect(snapshot.statements.map(({ name }) => name)).toEqual(["first", "nop"]);
    expect(snapshot.definitions.map(({ name }) => name)).toEqual(["target"]);
  });

  it("retains missing operand slots with zero-width insertion ranges", () => {
    const source = ".byte , one,, three,";
    const statement = createDocumentSnapshot(source, 0).statements[0]!;

    expect(statement.operands.map(({ text, range, missing }) => ({ text, range, missing }))).toEqual([
      { text: "", range: { start: 6, end: 6 }, missing: true },
      { text: "one", range: { start: 8, end: 11 }, missing: false },
      { text: "", range: { start: 12, end: 12 }, missing: true },
      { text: "three", range: { start: 14, end: 19 }, missing: false },
      { text: "", range: { start: 20, end: 20 }, missing: true }
    ]);
  });

  it("forms logical statements from ordinary LF and CRLF continuations", () => {
    const source = [
      "start: macro (one, \\",
      " two), \\\r",
      " three",
      "next: ret"
    ].join("\n");

    const snapshot = createDocumentSnapshot(source, 0);

    expect(snapshot.statements).toHaveLength(2);
    expect(statementSource(source, snapshot.statements[0]!))
      .toBe("start: macro (one, \\\n two), \\\r\n three");
    expect(operandSources(source, snapshot.statements[0]!)).toEqual([
      "(one, \\\n two)",
      "three"
    ]);
    expect(statementSource(source, snapshot.statements[1]!)).toBe("next: ret");
  });

  it("excludes bare-CR continuation trivia from operand ranges", () => {
    const source = "ldi r16, \\\r  1\rret";
    const snapshot = createDocumentSnapshot(source, 0);

    expect(snapshot.lineStarts).toEqual([0, 11, 15]);
    expect(snapshot.statements.map((statement) => statementSource(source, statement)))
      .toEqual(["ldi r16, \\\r  1", "ret"]);
    expect(operandSources(source, snapshot.statements[0]!)).toEqual(["r16", "1"]);
  });

  it("splices continuations inside quoted operands without exposing their commas", () => {
    const source = ".ascii \"first,\\\n second,third\", tail";
    const statement = createDocumentSnapshot(source, 0).statements[0]!;

    expect(operandSources(source, statement)).toEqual([
      "\"first,\\\n second,third\"",
      "tail"
    ]);
  });

  it("does not continue statements for terminal backslashes in line comments", () => {
    const source = [
      "first r1 ; comment \\",
      "second r2",
      "third r3 // comment \\",
      "fourth r4"
    ].join("\n");

    expect(createDocumentSnapshot(source, 0).statements.map(({ name }) => name))
      .toEqual(["first", "second", "third", "fourth"]);
  });

  it("uses logical ranges for continued definitions and labels", () => {
    const source = ".equ VALUE, \\\r\n  (1 << 3)\r\nlabel: ldi r16, \\\n  1";
    const snapshot = createDocumentSnapshot(source, 0);
    const definition = snapshot.definitions.find(({ name }) => name === "VALUE")!;
    const label = snapshot.definitions.find(({ name }) => name === "label")!;

    expect(statementSource(source, snapshot.statements[0]!))
      .toBe(".equ VALUE, \\\r\n  (1 << 3)");
    expect(definition.statementRange).toEqual(snapshot.statements[0]!.range);
    expect(source.slice(definition.expressionRange!.start, definition.expressionRange!.end))
      .toBe("\\\r\n  (1 << 3)");
    expect(label.statementRange).toEqual(snapshot.statements[1]!.range);
    expect(statementSource(source, snapshot.statements[1]!))
      .toBe("label: ldi r16, \\\n  1");
  });

  it("attaches source-preserving expressions to definition RHSs and non-missing operands", () => {
    const source = [
      ".equ VALUE, target /* gap */ + \\",
      "  0x2A",
      "ldi r16, lo8(-(table + 2))"
    ].join("\r\n");
    const snapshot = createDocumentSnapshot(source, 0);
    const definition = snapshot.definitions[0]!;
    const instruction = snapshot.statements[1]!;

    expect(definition.expression?.root).toMatchObject({
      kind: "binary",
      operator: "+",
      left: { kind: "symbol", name: "target" },
      right: { kind: "integer", text: "0x2A" }
    });
    expect(definition.expression?.range).toEqual(definition.expressionRange);
    expect(instruction.operands[0]?.expression?.root).toMatchObject({
      kind: "symbol", name: "r16"
    });
    expect(instruction.operands[1]?.expression?.root).toMatchObject({
      kind: "avrModifier",
      normalizedName: "lo8",
      argument: { kind: "unary", operator: "-" }
    });
    expect(instruction.operands.every(({ expression }) => expression !== undefined)).toBe(true);

    const missing = createDocumentSnapshot(".byte ,1", 0).statements[0]!.operands[0]!;
    expect(missing.missing).toBe(true);
    expect(missing.expression).toBeUndefined();
  });

  it("ignores comment-only, string-only, CPP, label-only, and assignment-only lines", () => {
    const source = [
      "; fake r1",
      "\"fake r2\"",
      "#define BODY \\",
      "  fake r3 \\",
      "  .byte 1",
      "label_only:",
      "name = 4",
      "label: value = 5",
      "/* fake r6 */",
      "real: add r16, r17"
    ].join("\n");

    const snapshot = createDocumentSnapshot(source, 0);

    expect(snapshot.statements.map(({ name }) => name)).toEqual(["add"]);
  });

  it("tolerates malformed statement syntax without discarding source ranges", () => {
    const source = [
      "macro (one, two",
      ".ascii \"unterminated, value",
      "other ]one, two",
      "_valid"
    ].join("\n");

    expect(() => createDocumentSnapshot(source, 0)).not.toThrow();
    const snapshot = createDocumentSnapshot(source, 0);
    expect(snapshot.statements.map(({ name }) => name))
      .toEqual(["macro", ".ascii", "other", "_valid"]);
    expect(operandSources(source, snapshot.statements[0]!)).toEqual(["(one, two"]);
    expect(operandSources(source, snapshot.statements[1]!)).toEqual([
      "\"unterminated, value"
    ]);
    expect(operandSources(source, snapshot.statements[2]!)).toEqual(["]one", "two"]);
  });

  it("deeply freezes statements, operands, and all ranges", () => {
    const snapshot = createDocumentSnapshot("label: ldi r16, 1", 0);
    const statement = snapshot.statements[0]!;

    expect(Object.isFrozen(snapshot.statements)).toBe(true);
    expect(Object.isFrozen(statement)).toBe(true);
    expect(Object.isFrozen(statement.range)).toBe(true);
    expect(Object.isFrozen(statement.nameRange)).toBe(true);
    expect(Object.isFrozen(statement.operands)).toBe(true);
    for (const operand of statement.operands) {
      expect(Object.isFrozen(operand)).toBe(true);
      expect(Object.isFrozen(operand.range)).toBe(true);
    }
    expect(() => (snapshot.statements as DocumentStatement[]).push(statement)).toThrow();
  });

  it("finds named, local, and repeatable numeric labels in source order", () => {
    const source = [
      "reset:",
      ".Lloop: rjmp 1f",
      "1: nop",
      "rjmp 1b",
      "1: ret",
      "12: rjmp 12b",
      "first: second: nop",
      ""
    ].join("\n");

    const snapshot = createDocumentSnapshot(source, 3);

    expect(definitionSummary(snapshot)).toEqual([
      { name: "reset", kind: "label" },
      { name: ".Lloop", kind: "localLabel" },
      { name: "1", kind: "numericLabel" },
      { name: "1", kind: "numericLabel" },
      { name: "12", kind: "numericLabel" },
      { name: "first", kind: "label" },
      { name: "second", kind: "label" }
    ]);
    expect(findDefinitions(snapshot, "1")).toHaveLength(2);
    expect(findDefinitions(snapshot, "1f")).toEqual([]);
    for (const definition of snapshot.definitions) {
      expect(source.slice(definition.nameRange.start, definition.nameRange.end))
        .toBe(definition.name);
    }
  });

  it("finds GNU constant and assignment forms with exact expression ranges", () => {
    const source = [
      ".equ MASK, (1 << 3)",
      ".EQUIV Fixed, MASK + 1",
      ".set cursor, Fixed",
      "alias = cursor + 2"
    ].join("\n");

    const snapshot = createDocumentSnapshot(source, 0);

    expect(definitionSummary(snapshot)).toEqual([
      { name: "MASK", kind: "equ" },
      { name: "Fixed", kind: "equiv" },
      { name: "cursor", kind: "set" },
      { name: "alias", kind: "assignment" }
    ]);
    expect(snapshot.definitions.map((definition) => {
      const range = definition.expressionRange;
      return range === undefined ? undefined : source.slice(range.start, range.end);
    })).toEqual(["(1 << 3)", "MASK + 1", "Fixed", "cursor + 2"]);
    expect(findDefinitions(snapshot, "MASK")).toHaveLength(1);
    expect(findDefinitions(snapshot, "mask")).toEqual([]);
  });

  it("accepts block comments between tokens and bare carriage-return lines", () => {
    const source = [
      ".equ/* directive */ VALUE /* name */, /* value */ 7",
      "local /* gap */ : nop",
      ""
    ].join("\r");

    const snapshot = createDocumentSnapshot(source, 0);

    expect(snapshot.lineStarts).toEqual([0, 52, 74]);
    expect(definitionSummary(snapshot)).toEqual([
      { name: "VALUE", kind: "equ" },
      { name: "local", kind: "label" }
    ]);
    const expressionRange = snapshot.definitions[0]?.expressionRange;
    expect(expressionRange === undefined
      ? undefined
      : source.slice(expressionRange.start, expressionRange.end)).toBe("7");
  });

  it("ignores definitions in comments, strings, and preprocessor lines", () => {
    const source = [
      "; fake:",
      "// .equ GHOST, 1",
      "/* start of comment",
      "blocked:",
      ".set hidden, 2",
      "*/ visible:",
      "#define ALSO_FAKE fake:",
      ".ascii \"not_a_label: ; // .equ NOPE, 1\"",
      "text = \"semi; slash// and escaped \\\" quote\" ; real comment"
    ].join("\n");

    const snapshot = createDocumentSnapshot(source, 1);

    expect(definitionSummary(snapshot)).toEqual([
      { name: "visible", kind: "label" },
      { name: "text", kind: "assignment" }
    ]);
    const expression = snapshot.definitions[1]?.expressionRange;
    expect(expression === undefined ? undefined : source.slice(expression.start, expression.end))
      .toBe("\"semi; slash// and escaped \\\" quote\"");
  });

  it("ignores definitions in continued preprocessor lines", () => {
    const source = [
      "#define BODY \\",
      "  fake_label: \\",
      "  .equ FAKE, 1",
      "real_label:"
    ].join("\n");

    const snapshot = createDocumentSnapshot(source, 1);

    expect(definitionSummary(snapshot)).toEqual([
      { name: "real_label", kind: "label" }
    ]);
  });

  it("preserves CRLF source and reports exact line and statement ranges", () => {
    const source = "start:\r\n.equ FOO, 1\r\nlast:";

    const snapshot = createDocumentSnapshot(source, 4);

    expect(snapshot.source).toBe(source);
    expect(snapshot.lineStarts).toEqual([0, 8, 21]);
    expect(snapshot.definitions.map(({ nameRange }) => [nameRange.start, nameRange.end]))
      .toEqual([[0, 5], [13, 16], [21, 25]]);
    expect(snapshot.definitions.map(({ statementRange }) => [
      statementRange.start,
      statementRange.end
    ])).toEqual([[0, 6], [8, 19], [21, 26]]);
    expect(snapshot.definitions[1]?.expressionRange).toEqual({ start: 18, end: 19 });
  });

  it.each([
    "",
    "\0:\n",
    ":",
    "1",
    ".equ",
    ".equ MISSING_COMMA 1",
    ".equ HALF,",
    "name =",
    "unterminated = \"value",
    "/* unterminated\nlabel:",
    "☃ λ : random \u0001 input"
  ])("tolerates malformed or incomplete input %#", (source) => {
    expect(() => createDocumentSnapshot(source, 0)).not.toThrow();
  });

  it("does not emit incomplete assignments and keeps definitions before later garbage", () => {
    const snapshot = createDocumentSnapshot([
      "complete:",
      ".equ HALF,",
      "name =",
      "unterminated = \"value",
      "/* remainder",
      "blocked:"
    ].join("\n"), 0);

    expect(definitionSummary(snapshot)).toEqual([
      { name: "complete", kind: "label" }
    ]);
  });

  it("does not treat inherited object property names as directives", () => {
    const snapshot = createDocumentSnapshot([
      "constructor SHOULD_NOT_PARSE, 1",
      "__proto__ SHOULD_NOT_PARSE, 2",
      ".equ REAL, 3"
    ].join("\n"), 0);

    expect(definitionSummary(snapshot)).toEqual([
      { name: "REAL", kind: "equ" }
    ]);
  });

  it("retains duplicate definitions and returns frozen ordered lookup results", () => {
    const source = [
      "same:",
      "same:",
      ".set value, 1",
      ".set value, 2",
      ".equiv once, 3",
      ".equiv once, 4"
    ].join("\n");
    const snapshot = createDocumentSnapshot(source, 2);

    expect(snapshot.definitions).toHaveLength(6);
    for (const name of ["same", "value", "once"]) {
      const matches = findDefinitions(snapshot, name);
      expect(matches).toHaveLength(2);
      expect(Object.isFrozen(matches)).toBe(true);
      expect(matches[0]?.nameRange.start).toBeLessThan(matches[1]?.nameRange.start ?? 0);
    }
  });

  it("creates fresh, deeply immutable snapshots", () => {
    const first = createDocumentSnapshot("start:\n.equ VALUE, 1", 8);
    const second = createDocumentSnapshot("start:\n.equ VALUE, 1", 8);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.lineStarts)).toBe(true);
    expect(Object.isFrozen(first.definitions)).toBe(true);
    for (const definition of first.definitions) {
      expectFrozenDefinition(definition);
    }
    expect(() => (first.definitions as LocalDefinition[]).push(first.definitions[0]!)).toThrow();
    expect(() => (first.lineStarts as number[]).push(100)).toThrow();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid document version %s",
    (version) => {
      expect(() => createDocumentSnapshot("", version))
        .toThrow("Document version must be a non-negative integer.");
    }
  );

  it("validates the source at the runtime boundary", () => {
    // @ts-expect-error Exercise JavaScript callers that bypass the TypeScript signature.
    expect(() => createDocumentSnapshot(undefined, 0))
      .toThrow("Document source must be a string.");
  });

  it("keeps all ranges valid across seeded arbitrary editor input", () => {
    const alphabet = [
      "\0", "\n", "\r", " ", "\t", ";", "/", "*", "#", "\\", "\"", "'",
      ".", "$", "_", ":", "=", ",", "0", "1", "A", "z", "☃", "\ud800"
    ];
    let state = 0x5eed1234;
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };

    for (let fixture = 0; fixture < 250; fixture += 1) {
      const source = Array.from(
        { length: next() % 257 },
        () => alphabet[next() % alphabet.length] ?? ""
      ).join("");
      const snapshot = createDocumentSnapshot(source, fixture);

      expect(snapshot.source).toBe(source);
      expect(snapshot.lineStarts[0]).toBe(0);
      expect([...snapshot.lineStarts].sort((left, right) => left - right))
        .toEqual(snapshot.lineStarts);
      for (const definition of snapshot.definitions) {
        expect(definition.nameRange.start).toBeGreaterThanOrEqual(definition.statementRange.start);
        expect(definition.nameRange.end).toBeLessThanOrEqual(definition.statementRange.end);
        expect(definition.statementRange.end).toBeLessThanOrEqual(source.length);
        expect(source.slice(definition.nameRange.start, definition.nameRange.end))
          .toBe(definition.name);
      }
      for (const statement of snapshot.statements) {
        expect(statement.nameRange.start).toBeGreaterThanOrEqual(statement.range.start);
        expect(statement.nameRange.end).toBeLessThanOrEqual(statement.range.end);
        expect(statement.range.end).toBeLessThanOrEqual(source.length);
        expect(source.slice(statement.nameRange.start, statement.nameRange.end))
          .toBe(statement.name);
        for (const operand of statement.operands) {
          expect(operand.range.start).toBeGreaterThanOrEqual(statement.nameRange.end);
          expect(operand.range.end).toBeLessThanOrEqual(statement.range.end);
          expect(source.slice(operand.range.start, operand.range.end)).toBe(operand.text);
          expect(operand.missing).toBe(operand.range.start === operand.range.end);
        }
      }
    }
  });
});
