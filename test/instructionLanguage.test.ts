import { describe, expect, it } from "vitest";

import {
  buildInstructionHover,
  findInstructionToken,
  getInstructionSignatureHelp
} from "../src/core/instructionLanguage";

describe("findInstructionToken", () => {
  it("finds a case-insensitive mnemonic after an optional label", () => {
    expect(findInstructionToken("loop:\t  lDi r16, 0", 9)).toEqual({
      text: "lDi",
      normalized: "LDI",
      start: 8,
      end: 11
    });
    expect(findInstructionToken("loop:\t  lDi r16, 0", 10)?.normalized).toBe("LDI");
  });

  it.each([
    ["loop: ldi r16, 0", 2],
    ["loop: ldi r16, 0", 12],
    ["loop:\t  lDi r16, 0", 11],
    ["; ldi r16, 0", 3],
    ["  # ldi r16, 0", 5],
    [".macro ldi", 8],
    ["myldi r16, 0", 2]
  ])("returns undefined outside a known mnemonic for %j", (line, cursor) => {
    expect(findInstructionToken(line, cursor)).toBeUndefined();
  });
});

describe("buildInstructionHover", () => {
  it("renders stable rich Markdown for an instruction", () => {
    const hover = buildInstructionHover("  ldi r16, 0", 3);

    expect(hover?.start).toBe(2);
    expect(hover?.end).toBe(5);
    expect(hover?.markdown).toContain("### `LDI`");
    expect(hover?.markdown).toContain("`LDI Rd, K`");
    expect(hover?.markdown).toContain("**Rd**");
    expect(hover?.markdown).toContain("**Cycles:** 1");
    expect(hover?.markdown).toContain("**SREG:** None");
    expect(hover?.markdown).toContain("Microchip AVR Instruction Set Manual");
    expect(hover?.markdown).not.toContain("command:");
    expect(hover?.markdown).not.toContain("<script");
  });

  it("renders every overload and omits empty operand sections", () => {
    expect(buildInstructionHover("lpm", 1)?.markdown).toContain("`LPM Rd, Z+`");
    expect(buildInstructionHover("ret", 1)?.markdown).not.toContain("**Operands**");
  });
});

describe("getInstructionSignatureHelp", () => {
  it("tracks the active top-level operand", () => {
    expect(getInstructionSignatureHelp("ldi r16, 0", 7)?.activeParameter).toBe(0);
    expect(getInstructionSignatureHelp("ldi r16, 0", 9)?.activeParameter).toBe(1);
    expect(getInstructionSignatureHelp("ldi r16, lo8(foo, bar)", 22)?.activeParameter).toBe(1);
  });

  it("selects a compatible overload and preserves immutable signatures", () => {
    const empty = getInstructionSignatureHelp("lpm", 3);
    const operands = getInstructionSignatureHelp("lpm r16, Z+", 11);

    expect(empty?.signatures.map(({ label }) => label)).toEqual([
      "LPM",
      "LPM Rd, Z",
      "LPM Rd, Z+"
    ]);
    expect(empty?.activeSignature).toBe(0);
    expect(operands?.activeSignature).toBe(2);
    expect(operands?.activeParameter).toBe(1);
    expect(Object.isFrozen(operands)).toBe(true);
    expect(Object.isFrozen(operands?.signatures)).toBe(true);
    expect(operands?.signatures.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(operands?.signatures[0]?.parameters)).toBe(true);
    expect(operands?.signatures.flatMap(({ parameters }) => parameters).every(Object.isFrozen))
      .toBe(true);
  });

  it.each([
    ["unknown r16, 0", 15],
    ["; ldi r16, 0", 12],
    ["ldi r16, 0 ; comment, here", 25],
    ["label: ldi r16, 0", 4]
  ])("returns undefined outside a valid invocation for %j", (line, cursor) => {
    expect(getInstructionSignatureHelp(line, cursor)).toBeUndefined();
  });

  it("supports mixed-case instructions after labels", () => {
    expect(getInstructionSignatureHelp("label: LdI r16, 0", 18)?.activeParameter).toBe(1);
  });
});
