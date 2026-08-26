import { describe, expect, it } from "vitest";

import { AVR_INSTRUCTIONS, findInstruction } from "../src/core/instructions";

const EXPECTED_MNEMONICS = [
  "ADC", "ADD", "ADIW", "AND", "ANDI", "ASR", "BCLR", "BLD", "BRBC", "BRBS",
  "BRCC", "BRCS", "BREAK", "BREQ", "BRGE", "BRHC", "BRHS", "BRID", "BRIE", "BRLO",
  "BRLT", "BRMI", "BRNE", "BRPL", "BRSH", "BRTC", "BRTS", "BRVC", "BRVS", "BSET",
  "BST", "CALL", "CBI", "CBR", "CLC", "CLH", "CLI", "CLN", "CLR", "CLS", "CLT",
  "CLV", "CLZ", "COM", "CP", "CPC", "CPI", "CPSE", "DEC", "DES", "EICALL", "EIJMP",
  "ELPM", "EOR", "FMUL", "FMULS", "FMULSU", "ICALL", "IJMP", "IN", "INC", "JMP",
  "LAC", "LAS", "LAT", "LD", "LDD", "LDI", "LDS", "LPM", "LSL", "LSR", "MOV",
  "MOVW", "MUL", "MULS", "MULSU", "NEG", "NOP", "OR", "ORI", "OUT", "POP", "PUSH",
  "RCALL", "RET", "RETI", "RJMP", "ROL", "ROR", "SBC", "SBCI", "SBI", "SBIC", "SBIS",
  "SBIW", "SBR", "SBRC", "SBRS", "SEC", "SEH", "SEI", "SEN", "SER", "SES", "SET",
  "SEV", "SEZ", "SLEEP", "SPM", "ST", "STD", "STS", "SUB", "SUBI", "SWAP", "TST",
  "WDR", "XCH"
] as const;

describe("AVR_INSTRUCTIONS", () => {
  it("contains the complete documented mnemonic union exactly once", () => {
    expect(AVR_INSTRUCTIONS.map(({ mnemonic }) => mnemonic)).toEqual(EXPECTED_MNEMONICS);
    expect(new Set(AVR_INSTRUCTIONS.map(({ mnemonic }) => mnemonic)).size)
      .toBe(EXPECTED_MNEMONICS.length);
  });

  it("provides structured documentation for every instruction and form", () => {
    const allowedFlags = new Set(["C", "Z", "N", "V", "S", "H", "T", "I"]);
    for (const instruction of AVR_INSTRUCTIONS) {
      expect(instruction.mnemonic).toMatch(/^[A-Z]+$/u);
      expect(instruction.summary.length).toBeGreaterThan(0);
      expect(instruction.forms.length).toBeGreaterThan(0);
      expect(instruction.availability.length).toBeGreaterThan(0);
      expect(instruction.documentationUrl).toMatch(/^https:\/\/onlinedocs\.microchip\.com\//u);
      expect(new Set(instruction.forms.map(({ syntax }) => syntax)).size)
        .toBe(instruction.forms.length);
      expect(instruction.statusFlags.every((flag) => allowedFlags.has(flag))).toBe(true);
      for (const form of instruction.forms) {
        expect(form.syntax.startsWith(instruction.mnemonic)).toBe(true);
        expect(form.cycles.length).toBeGreaterThan(0);
        for (const operand of form.operands) {
          expect(operand.label.length).toBeGreaterThan(0);
          expect(operand.description.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("deeply freezes the catalogue and performs case-insensitive exact lookup", () => {
    const ldi = findInstruction("LdI");

    expect(ldi).toBe(findInstruction("ldi"));
    expect(ldi).toBe(findInstruction("LDI"));
    expect(findInstruction(" LDI")).toBeUndefined();
    expect(findInstruction("LD")).not.toBe(findInstruction("LDI"));
    expect(findInstruction("unknown")).toBeUndefined();
    expect(Object.isFrozen(AVR_INSTRUCTIONS)).toBe(true);
    expect(Object.isFrozen(ldi)).toBe(true);
    expect(Object.isFrozen(ldi?.forms)).toBe(true);
    expect(Object.isFrozen(ldi?.forms[0])).toBe(true);
    expect(Object.isFrozen(ldi?.forms[0]?.operands)).toBe(true);
      expect(Object.isFrozen(ldi?.forms[0]?.operands[0])).toBe(true);
    expect(Object.isFrozen(ldi?.statusFlags)).toBe(true);
    expect(AVR_INSTRUCTIONS.every(Object.isFrozen)).toBe(true);
    expect(AVR_INSTRUCTIONS.flatMap(({ forms }) => forms).every(Object.isFrozen)).toBe(true);
    expect(AVR_INSTRUCTIONS.flatMap(({ forms }) => forms)
      .flatMap(({ operands }) => operands).every(Object.isFrozen)).toBe(true);
  });

  it("models representative aliases, overloads, flags, timing, and availability", () => {
    expect(findInstruction("CLR")?.aliasOf).toBe("EOR");
    expect(findInstruction("BRCC")?.aliasOf).toBe("BRBC");
    expect(findInstruction("LPM")?.forms.map(({ syntax }) => syntax)).toEqual([
      "LPM",
      "LPM Rd, Z",
      "LPM Rd, Z+"
    ]);
    expect(findInstruction("LDI")?.statusFlags).toEqual([]);
    expect(findInstruction("ADC")?.statusFlags).toEqual(["Z", "C", "N", "V", "S", "H"]);
    expect(findInstruction("XCH")?.availability).toContain("AVRxm");
    expect(findInstruction("LDI")?.forms[0]?.cycles).toBe("1");
  });
});
