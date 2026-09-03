import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  parseExpression,
  type ExpressionNode,
  type ParsedExpression
} from "../src/core/expressions";

type ExpressionSummary = string | readonly [string, ExpressionSummary, ExpressionSummary];

function summary(node: ExpressionNode): ExpressionSummary {
  if (node.kind === "symbol") {
    return node.name;
  }
  if (node.kind === "binary") {
    return [node.operator, summary(node.left), summary(node.right)];
  }
  return node.kind;
}

function expectDeeplyFrozen(node: ExpressionNode): void {
  expect(Object.isFrozen(node)).toBe(true);
  expect(Object.isFrozen(node.range)).toBe(true);
  if (node.kind === "unary") {
    expect(Object.isFrozen(node.operatorRange)).toBe(true);
    expectDeeplyFrozen(node.operand);
  } else if (node.kind === "binary") {
    expect(Object.isFrozen(node.operatorRange)).toBe(true);
    expectDeeplyFrozen(node.left);
    expectDeeplyFrozen(node.right);
  } else if (node.kind === "parenthesized") {
    expect(Object.isFrozen(node.openRange)).toBe(true);
    if (node.closeRange !== undefined) {
      expect(Object.isFrozen(node.closeRange)).toBe(true);
    }
    expectDeeplyFrozen(node.expression);
  } else if (node.kind === "avrModifier") {
    expect(Object.isFrozen(node.nameRange)).toBe(true);
    expect(Object.isFrozen(node.openRange)).toBe(true);
    if (node.closeRange !== undefined) {
      expect(Object.isFrozen(node.closeRange)).toBe(true);
    }
    expectDeeplyFrozen(node.argument);
  }
}

function root(source: string): ExpressionNode {
  return parseExpression(source, { start: 0, end: source.length }).root;
}

function childNodes(node: ExpressionNode): readonly ExpressionNode[] {
  switch (node.kind) {
    case "unary": return [node.operand];
    case "binary": return [node.left, node.right];
    case "parenthesized": return [node.expression];
    case "avrModifier": return [node.argument];
    default: return [];
  }
}

function expectValidTree(node: ExpressionNode, start: number, end: number): void {
  expect(node.range.start).toBeGreaterThanOrEqual(start);
  expect(node.range.end).toBeGreaterThanOrEqual(node.range.start);
  expect(node.range.end).toBeLessThanOrEqual(end);
  expect(Object.isFrozen(node)).toBe(true);
  expect(Object.isFrozen(node.range)).toBe(true);
  for (const child of childNodes(node)) {
    expectValidTree(child, start, end);
  }
}

describe("GNU AVR expressions", () => {
  it("models nested AVR modifiers, unary operators, parentheses, and absolute ranges", () => {
    const source = "lo8(-(table + 2))";
    const parsed = parseExpression(source, { start: 0, end: source.length });

    expect(parsed).toEqual({
      range: { start: 0, end: 17 },
      root: {
        kind: "avrModifier",
        name: "lo8",
        normalizedName: "lo8",
        range: { start: 0, end: 17 },
        nameRange: { start: 0, end: 3 },
        openRange: { start: 3, end: 4 },
        closeRange: { start: 16, end: 17 },
        argument: {
          kind: "unary",
          operator: "-",
          range: { start: 4, end: 16 },
          operatorRange: { start: 4, end: 5 },
          operand: {
            kind: "parenthesized",
            range: { start: 5, end: 16 },
            openRange: { start: 5, end: 6 },
            closeRange: { start: 15, end: 16 },
            expression: {
              kind: "binary",
              operator: "+",
              range: { start: 6, end: 15 },
              operatorRange: { start: 12, end: 13 },
              left: { kind: "symbol", name: "table", range: { start: 6, end: 11 } },
              right: { kind: "integer", text: "2", range: { start: 14, end: 15 } }
            }
          }
        }
      },
      status: "complete"
    });
  });

  it("uses GNU as precedence and left associativity instead of C precedence", () => {
    expect(summary(root("a << b * c"))).toEqual(["*", ["<<", "a", "b"], "c"]);
    expect(summary(root("a | b & c"))).toEqual(["&", ["|", "a", "b"], "c"]);
    expect(summary(root("a == b + c"))).toEqual(["+", ["==", "a", "b"], "c"]);
    expect(summary(root("a || b && c"))).toEqual(["||", "a", ["&&", "b", "c"]]);
  });

  it("preserves GNU integer spellings, symbols, the location counter, and numeric labels", () => {
    expect(root("0b1010")).toEqual({
      kind: "integer", text: "0b1010", range: { start: 0, end: 6 }
    });
    expect(root("077")).toEqual({
      kind: "integer", text: "077", range: { start: 0, end: 3 }
    });
    expect(root("42")).toEqual({
      kind: "integer", text: "42", range: { start: 0, end: 2 }
    });
    expect(root("0x2A")).toEqual({
      kind: "integer", text: "0x2A", range: { start: 0, end: 4 }
    });
    expect(root(".")).toEqual({ kind: "locationCounter", range: { start: 0, end: 1 } });
    expect(root("1f")).toEqual({
      kind: "numericLabelReference",
      label: "1",
      direction: "forward",
      range: { start: 0, end: 2 }
    });
    expect(root("12b")).toEqual({
      kind: "numericLabelReference",
      label: "12",
      direction: "backward",
      range: { start: 0, end: 3 }
    });
  });

  it("preserves GNU as character constants, including supported escapes", () => {
    const characterConstants = [
      "'A",
      "'\\b",
      "'\\f",
      "'\\n",
      "'\\r",
      "'\\t",
      "'\\\"",
      "'\\'",
      "'\\\\"
    ] as const;

    for (const source of characterConstants) {
      const parsed = parseExpression(source, { start: 0, end: source.length });

      expect(parsed.status).toBe("complete");
      expect(parsed.root).toEqual({
        kind: "integer",
        text: source,
        range: { start: 0, end: source.length }
      });
    }
  });

  it("does not report incomplete hexadecimal or binary prefixes as complete", () => {
    for (const source of ["0x", "0X", "0b", "0B"] as const) {
      const parsed = parseExpression(source, { start: 0, end: source.length });

      expect(parsed.status).toBe("incomplete");
      expect(parsed.root).toEqual({
        kind: "integer",
        text: source,
        range: { start: 0, end: source.length }
      });
    }
  });

  it("accepts unary plus without changing the operand range", () => {
    const parsed = parseExpression("+1", { start: 0, end: 2 });

    expect(parsed.status).toBe("complete");
    expect(parsed.root).toEqual({
      kind: "unary",
      operator: "+",
      range: { start: 0, end: 2 },
      operatorRange: { start: 0, end: 1 },
      operand: { kind: "integer", text: "1", range: { start: 1, end: 2 } }
    });
  });

  it("recognizes every AVR relocatable-expression modifier case-insensitively", () => {
    const modifiers = [
      "lo8", "hi8", "hlo8", "hh8", "hhi8", "pm", "gs", "pm_lo8", "pm_hi8", "pm_hh8"
    ] as const;

    for (const modifier of modifiers) {
      const parsed = parseExpression(`${modifier.toUpperCase()}(target)`, {
        start: 0,
        end: modifier.length + 8
      });
      expect(parsed.status).toBe("complete");
      expect(parsed.root).toMatchObject({
        kind: "avrModifier",
        name: modifier.toUpperCase(),
        normalizedName: modifier,
        argument: { kind: "symbol", name: "target" }
      });
    }
  });

  it("recovers immutable partial trees from incomplete and invalid editor input", () => {
    const trailing = parseExpression("value +", { start: 0, end: 7 });
    expect(trailing.status).toBe("incomplete");
    expect(trailing.root).toMatchObject({
      kind: "binary",
      range: { start: 0, end: 7 },
      operator: "+",
      right: { kind: "missing", range: { start: 7, end: 7 } }
    });

    const modifier = parseExpression("lo8(", { start: 0, end: 4 });
    expect(modifier.status).toBe("incomplete");
    expect(modifier.root).toMatchObject({
      kind: "avrModifier",
      range: { start: 0, end: 4 },
      argument: { kind: "missing", range: { start: 4, end: 4 } }
    });
    expect((modifier.root as { closeRange?: unknown }).closeRange).toBeUndefined();

    const parenthesized = parseExpression("(1 + 2", { start: 0, end: 6 });
    expect(parenthesized.status).toBe("incomplete");
    expect(parenthesized.root).toMatchObject({
      kind: "parenthesized",
      range: { start: 0, end: 6 },
      expression: { kind: "binary", operator: "+", range: { start: 1, end: 6 } }
    });

    const invalid = parseExpression("1 + @ + 2", { start: 0, end: 9 });
    expect(invalid.status).toBe("invalid");
    expect(invalid.root).toMatchObject({
      kind: "binary",
      operator: "+",
      left: {
        kind: "binary",
        operator: "+",
        right: { kind: "unknown", range: { start: 4, end: 5 } }
      },
      right: { kind: "integer", text: "2" }
    });

    for (const parsed of [trailing, modifier, parenthesized, invalid]) {
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed.range)).toBe(true);
      expectDeeplyFrozen(parsed.root);
    }
  });

  it("bounds nesting and validates public source ranges", () => {
    const source = "(".repeat(140) + "1" + ")".repeat(140);
    const parsed = parseExpression(source, { start: 0, end: source.length });

    expect(parsed.status).toBe("invalid");
    expect(() => parseExpression(source, { start: -1, end: 1 })).toThrow(
      "Expression range must be within the source."
    );
    expect(() => parseExpression(source, { start: 2, end: 1 })).toThrow(
      "Expression range must be within the source."
    );
    expect(() => parseExpression(source, { start: 0.5, end: 1 })).toThrow(
      "Expression range must use integer offsets."
    );
    expect(() => parseExpression(42 as unknown as string, { start: 0, end: 0 })).toThrow(
      "Expression source must be a string."
    );
    expect(() => parseExpression(source, undefined as unknown as { start: number; end: number }))
      .toThrow("Expression range must be an object.");
    expect(() => parseExpression(source, null as unknown as { start: number; end: number }))
      .toThrow("Expression range must be an object.");
  });

  it("keeps block-comment trivia bounded to the requested source range", () => {
    const suffix = "x".repeat(1_000_000);
    const source = `1 /*${suffix}*/`;
    const startedAt = performance.now();

    const parsed = parseExpression(source, { start: 0, end: 4 });
    const duration = performance.now() - startedAt;

    expect(parsed.status).toBe("complete");
    expect(parsed.root).toEqual({
      kind: "integer",
      text: "1",
      range: { start: 0, end: 1 }
    });
    expect(duration).toBeLessThan(50);
  });

  it("never lets token lookahead escape the requested source range", () => {
    const source = "0x << 1f \\\r\n /* comment */ target";

    for (let end = 0; end <= source.length; end += 1) {
      const parsed = parseExpression(source, { start: 0, end });
      expectValidTree(parsed.root, 0, end);
      if (parsed.remainderRange !== undefined) {
        expect(parsed.remainderRange.start).toBeLessThanOrEqual(end);
        expect(parsed.remainderRange.end).toBe(end);
      }
    }
  });

  it("retains the requested range while skipping comments and line splices as trivia", () => {
    const source = "prefix target /* gap */ + \\\r\n  0x2A suffix";
    const parsed: ParsedExpression = parseExpression(source, { start: 7, end: 35 });

    expect(parsed.range).toEqual({ start: 7, end: 35 });
    expect(parsed.status).toBe("complete");
    expect(parsed.root).toMatchObject({
      kind: "binary",
      range: { start: 7, end: 35 },
      operatorRange: { start: 24, end: 25 },
      left: { kind: "symbol", name: "target", range: { start: 7, end: 13 } },
      right: { kind: "integer", text: "0x2A", range: { start: 31, end: 35 } }
    });
  });

  it("keeps ranges valid and parsing total across seeded arbitrary editor input", () => {
    let state = 0x41c6ce57;
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };
    const alphabet = "abcXYZ_0129.+-~*/%<>=!&|^()@ \\/*\r\n\t";

    for (let fixture = 0; fixture < 500; fixture += 1) {
      const source = Array.from(
        { length: next() % 257 },
        () => alphabet[next() % alphabet.length] ?? ""
      ).join("");
      const parsed = parseExpression(source, { start: 0, end: source.length });

      expect(parsed.range).toEqual({ start: 0, end: source.length });
      expectValidTree(parsed.root, 0, source.length);
      if (parsed.remainderRange !== undefined) {
        expect(parsed.remainderRange.start).toBeGreaterThanOrEqual(0);
        expect(parsed.remainderRange.end).toBeLessThanOrEqual(source.length);
        expect(Object.isFrozen(parsed.remainderRange)).toBe(true);
      }
    }
  });
});
