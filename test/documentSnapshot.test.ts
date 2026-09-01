import { describe, expect, it } from "vitest";

import {
  createDocumentSnapshot,
  findDefinitions,
  type DocumentSnapshot,
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

describe("document snapshots", () => {
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
    }
  });
});
