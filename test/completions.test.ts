import { describe, expect, it } from "vitest";

import { buildCompletionCandidates } from "../src/core/completions";
import { AVR_INSTRUCTIONS } from "../src/core/instructions";

describe("buildCompletionCandidates", () => {
  it("merges, deduplicates, and sorts static and device symbols", () => {
    const result = buildCompletionCandidates([
      { name: "PORTB", expansion: "_SFR_IO8(0x05)" },
      { name: "LDI", expansion: "device collision" }
    ]);

    expect(result.find((candidate) => candidate.label === "PORTB")).toEqual({
      label: "PORTB",
      detail: "AVR device macro — _SFR_IO8(0x05)",
      kind: "device"
    });
    expect(result.filter((candidate) => candidate.label === "LDI")).toHaveLength(1);
    expect(result.find((candidate) => candidate.label === "LDI")).toMatchObject({
      detail: "LDI Rd, K — Load an immediate value",
      kind: "instruction"
    });
    expect(result.find((candidate) => candidate.label === "LDI")?.documentation)
      .toContain("Destination register r16–r31");
    expect(result.filter(({ kind }) => kind === "instruction"))
      .toHaveLength(AVR_INSTRUCTIONS.length);
    expect(result.map(({ label }) => label)).toEqual(
      [...result.map(({ label }) => label)].sort((left, right) => left.localeCompare(right))
    );
  });

  it("preserves case-sensitive macros that only resemble an instruction", () => {
    const result = buildCompletionCandidates([{ name: "ldi", expansion: "collision" }]);

    expect(result.filter(({ label }) => label.toUpperCase() === "LDI")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "LDI", kind: "instruction" }),
        expect.objectContaining({ label: "ldi", kind: "device" })
      ])
    );
  });

  it("returns a new frozen catalog for every call", () => {
    const first = buildCompletionCandidates([]);
    const second = buildCompletionCandidates([]);

    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
  });
});
