import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AVR_INSTRUCTIONS } from "../src/core/instructions";

describe("AVR TextMate grammar", () => {
  it("highlights every instruction in the canonical catalogue", () => {
    const grammar = JSON.parse(readFileSync(
      join(process.cwd(), "syntaxes", "avr-asm.tmLanguage.json"),
      "utf8"
    )) as { repository: { instructions: { patterns: Array<{ match: string }> } } };
    const source = grammar.repository.instructions.patterns[0]?.match.replace("(?i)", "");
    const pattern = new RegExp(source ?? "", "iu");

    for (const instruction of AVR_INSTRUCTIONS) {
      expect(pattern.test(instruction.mnemonic)).toBe(true);
    }
    expect(pattern.test("NOT_AN_AVR_INSTRUCTION")).toBe(false);
  });
});
