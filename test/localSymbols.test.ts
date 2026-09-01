import { describe, expect, it } from "vitest";

import { createDocumentSnapshot } from "../src/core/documentSnapshot";
import {
  localDefinitionTargets,
  localDocumentSymbols,
  localSymbolCompletions,
  localSymbolHover,
  type LocalDocumentSymbol,
  type LocalSymbolCompletion
} from "../src/core/localSymbols";

function occurrence(source: string, text: string, occurrenceIndex = 0): number {
  let offset = -1;
  for (let index = 0; index <= occurrenceIndex; index += 1) {
    offset = source.indexOf(text, offset + 1);
  }
  if (offset < 0) {
    throw new Error(`Missing test occurrence: ${text}`);
  }
  return offset;
}

describe("local symbol services", () => {
  it("returns unique named completions in definition order and excludes numeric labels", () => {
    const snapshot = createDocumentSnapshot([
      "start:",
      ".Lloop:",
      "1: nop",
      ".equ LIMIT, 4",
      "start:",
      ".set cursor, LIMIT",
      "alias = cursor + 1"
    ].join("\n"), 1);

    const completions = localSymbolCompletions(snapshot);

    expect(completions.map(({ label, kind, detail }) => ({ label, kind, detail }))).toEqual([
      { label: "start", kind: "label", detail: "Label" },
      { label: ".Lloop", kind: "localLabel", detail: "Local label" },
      { label: "LIMIT", kind: "equ", detail: "Constant (.equ)" },
      { label: "cursor", kind: "set", detail: "Mutable constant (.set)" },
      { label: "alias", kind: "assignment", detail: "Assignment" }
    ]);
    expect(completions[0]?.definition).toBe(snapshot.definitions[0]);
    expect(Object.isFrozen(completions)).toBe(true);
    for (const completion of completions) {
      expect(Object.isFrozen(completion)).toBe(true);
    }
    expect(() => (completions as LocalSymbolCompletion[]).push(completions[0]!)).toThrow();
  });

  it("appends only valid directional numeric completions at the current offset", () => {
    const source = [
      "3: nop",
      "1: nop",
      "named:",
      "  rjmp ",
      "1: nop",
      "2: ret"
    ].join("\n");
    const snapshot = createDocumentSnapshot(source, 1);
    const completions = localSymbolCompletions(snapshot, source.indexOf("  rjmp ") + 7);

    expect(completions.map(({ label, kind, detail }) => ({ label, kind, detail }))).toEqual([
      { label: "named", kind: "label", detail: "Label" },
      { label: "3b", kind: "numericLabel", detail: "Numeric label (backward)" },
      { label: "1b", kind: "numericLabel", detail: "Numeric label (backward)" },
      { label: "1f", kind: "numericLabel", detail: "Numeric label (forward)" },
      { label: "2f", kind: "numericLabel", detail: "Numeric label (forward)" }
    ]);
    expect(completions.some(({ label }) => label === "1")).toBe(false);
    expect(completions[1]?.definition.nameRange.start).toBe(occurrence(source, "3:"));
    expect(completions[2]?.definition.nameRange.start).toBe(occurrence(source, "1:", 0));
    expect(completions[3]?.definition.nameRange.start).toBe(occurrence(source, "1:", 1));
  });

  it("returns document symbols for every definition in source order", () => {
    const source = [
      "first: second: nop",
      "1: rjmp 1f",
      "1: ret",
      ".equ VALUE, 7",
      ".equiv fixed, VALUE",
      ".set changing, fixed",
      "alias = changing"
    ].join("\n");
    const snapshot = createDocumentSnapshot(source, 2);

    const symbols = localDocumentSymbols(snapshot);

    expect(symbols.map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: "first", kind: "label" },
      { name: "second", kind: "label" },
      { name: "1", kind: "numericLabel" },
      { name: "1", kind: "numericLabel" },
      { name: "VALUE", kind: "equ" },
      { name: "fixed", kind: "equiv" },
      { name: "changing", kind: "set" },
      { name: "alias", kind: "assignment" }
    ]);
    expect(symbols[0]).toMatchObject({
      range: snapshot.definitions[0]?.statementRange,
      selectionRange: snapshot.definitions[0]?.nameRange,
      definition: snapshot.definitions[0]
    });
    expect(symbols[1]?.range).toEqual(symbols[0]?.range);
    expect(Object.isFrozen(symbols)).toBe(true);
    for (const symbol of symbols) {
      expect(Object.isFrozen(symbol)).toBe(true);
      expect(Object.isFrozen(symbol.range)).toBe(true);
      expect(Object.isFrozen(symbol.selectionRange)).toBe(true);
    }
    expect(() => (symbols as LocalDocumentSymbol[]).pop()).toThrow();
  });

  it("provides hover data at named, local, numeric, directive, and assignment symbols", () => {
    const source = [
      "start:",
      "  rjmp start",
      ".Lloop: rjmp .Lloop",
      "1: nop",
      "  rjmp 1b",
      ".equ MASK, (1 << 3)",
      ".equiv FIXED, MASK + 1",
      ".set cursor, FIXED",
      "alias = cursor + 2",
      "  ldi r16, alias"
    ].join("\n");
    const snapshot = createDocumentSnapshot(source, 3);

    expect(localSymbolHover(snapshot, occurrence(source, "start", 1))).toMatchObject({
      name: "start",
      kind: "label",
      detail: "Label: start",
      definition: snapshot.definitions[0]
    });
    expect(localSymbolHover(snapshot, occurrence(source, ".Lloop", 1))).toMatchObject({
      name: ".Lloop",
      kind: "localLabel",
      detail: "Local label: .Lloop"
    });
    expect(localSymbolHover(snapshot, occurrence(source, "1b"))).toMatchObject({
      name: "1",
      kind: "numericLabel",
      detail: "Numeric label: 1"
    });
    expect(localSymbolHover(snapshot, occurrence(source, "MASK", 1))).toMatchObject({
      name: "MASK",
      kind: "equ",
      detail: ".equ MASK = (1 << 3)",
      expression: "(1 << 3)"
    });
    expect(localSymbolHover(snapshot, occurrence(source, "FIXED", 1))).toMatchObject({
      name: "FIXED",
      kind: "equiv",
      detail: ".equiv FIXED = MASK + 1",
      expression: "MASK + 1"
    });
    expect(localSymbolHover(snapshot, occurrence(source, "cursor", 1))).toMatchObject({
      name: "cursor",
      kind: "set",
      detail: ".set cursor = FIXED",
      expression: "FIXED"
    });
    const assignmentHover = localSymbolHover(snapshot, occurrence(source, "alias", 1));
    expect(assignmentHover).toMatchObject({
      name: "alias",
      kind: "assignment",
      detail: "alias = cursor + 2",
      expression: "cursor + 2"
    });
    expect(assignmentHover?.range).toEqual({
      start: occurrence(source, "alias", 1),
      end: occurrence(source, "alias", 1) + "alias".length
    });
    expect(Object.isFrozen(assignmentHover)).toBe(true);
    expect(Object.isFrozen(assignmentHover?.range)).toBe(true);
  });

  it("resolves every exact named definition and the nearest directional numeric label", () => {
    const source = [
      "same:",
      "  rjmp 1f",
      "1: nop",
      "  rjmp same",
      "  rjmp 1b",
      "1: nop",
      "  rjmp 1b",
      "  rjmp 2f",
      "2: ret",
      "same: ret"
    ].join("\n");
    const snapshot = createDocumentSnapshot(source, 4);

    const named = localDefinitionTargets(snapshot, occurrence(source, "same", 1));
    expect(named.map(({ targetSelectionRange }) => targetSelectionRange.start)).toEqual([
      occurrence(source, "same", 0),
      occurrence(source, "same", 2)
    ]);
    const forward = localDefinitionTargets(snapshot, occurrence(source, "1f"));
    expect(forward).toHaveLength(1);
    expect(forward[0]?.targetSelectionRange.start).toBe(occurrence(source, "1:", 0));
    const firstBack = localDefinitionTargets(snapshot, occurrence(source, "1b", 0));
    expect(firstBack[0]?.targetSelectionRange.start).toBe(occurrence(source, "1:", 0));
    const secondBack = localDefinitionTargets(snapshot, occurrence(source, "1b", 1));
    expect(secondBack[0]?.targetSelectionRange.start).toBe(occurrence(source, "1:", 1));
    expect(localDefinitionTargets(snapshot, occurrence(source, "2f"))[0]?.definition.name)
      .toBe("2");
    expect(localDefinitionTargets(snapshot, occurrence(source, "1:", 0))[0]?.targetSelectionRange.start)
      .toBe(occurrence(source, "1:", 0));
    expect(Object.isFrozen(named)).toBe(true);
    expect(Object.isFrozen(named[0])).toBe(true);
    expect(Object.isFrozen(named[0]?.originSelectionRange)).toBe(true);
  });

  it("does not resolve mnemonic or directive positions that collide with labels", () => {
    const source = [
      "rjmp:",
      ".equ:",
      "  rjmp rjmp",
      "  .equ VALUE, 1",
      "  rjmp .equ"
    ].join("\n");
    const snapshot = createDocumentSnapshot(source, 4);

    expect(localSymbolHover(snapshot, occurrence(source, "rjmp", 1))).toBeUndefined();
    expect(localDefinitionTargets(snapshot, occurrence(source, "rjmp", 1))).toEqual([]);
    expect(localDefinitionTargets(snapshot, occurrence(source, "rjmp", 2))).toHaveLength(1);
    expect(localSymbolHover(snapshot, occurrence(source, ".equ", 1))).toBeUndefined();
    expect(localDefinitionTargets(snapshot, occurrence(source, ".equ", 1))).toEqual([]);
    expect(localDefinitionTargets(snapshot, occurrence(source, ".equ", 2))).toHaveLength(1);
  });

  it("ignores symbol-looking tokens in comments, strings, and preprocessor lines", () => {
    const source = [
      "real:",
      "  rjmp real ; real in comment",
      "  .ascii \"real 1f fake\"",
      "// real",
      "/* real 1b */",
      "#define ALIAS real \\",
      "  real",
      "  rjmp real"
    ].join("\n");
    const snapshot = createDocumentSnapshot(source, 5);
    const ignoredOffsets = [
      occurrence(source, "real", 2),
      occurrence(source, "real", 3),
      occurrence(source, "real", 4),
      occurrence(source, "real", 5),
      occurrence(source, "real", 6),
      occurrence(source, "real", 7)
    ];

    for (const offset of ignoredOffsets) {
      expect(localSymbolHover(snapshot, offset)).toBeUndefined();
      expect(localDefinitionTargets(snapshot, offset)).toEqual([]);
    }
    expect(localDefinitionTargets(snapshot, occurrence(source, "real", 8))).toHaveLength(1);
  });

  it("tolerates invalid and boundary offsets without throwing", () => {
    const source = "target:\n  rjmp target";
    const snapshot = createDocumentSnapshot(source, 6);
    const referenceStart = occurrence(source, "target", 1);

    expect(localSymbolHover(snapshot, referenceStart + "target".length)?.name).toBe("target");
    expect(localDefinitionTargets(snapshot, referenceStart + "target".length)).toHaveLength(1);
    for (const offset of [-1, source.length + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => localSymbolHover(snapshot, offset)).not.toThrow();
      expect(localSymbolHover(snapshot, offset)).toBeUndefined();
      expect(() => localDefinitionTargets(snapshot, offset)).not.toThrow();
      expect(localDefinitionTargets(snapshot, offset)).toEqual([]);
    }
  });
});
