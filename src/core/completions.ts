import type { AvrMacro, CompletionCandidate } from "./types";

const INSTRUCTIONS = [
  "ADC", "ADD", "AND", "ANDI", "BREQ", "BRNE", "CALL", "CBI", "CLR", "CP",
  "CPC", "CPI", "DEC", "EOR", "ICALL", "IJMP", "IN", "INC", "JMP", "LD",
  "LDI", "LDS", "LPM", "MOV", "MOVW", "NOP", "OR", "ORI", "OUT", "POP",
  "PUSH", "RCALL", "RET", "RETI", "RJMP", "SBI", "SBIC", "SBIS", "SBIW",
  "SEI", "SLEEP", "ST", "STS", "SUB", "SUBI", "SWAP", "TST", "WDR"
] as const;

const REGISTERS = Array.from({ length: 32 }, (_, index) => `r${index}`);
const POINTER_REGISTERS = ["X", "Y", "Z"] as const;
const DIRECTIVES = [
  ".byte", ".data", ".equ", ".global", ".macro", ".section", ".set", ".text", ".word"
] as const;

function frozenCandidate(candidate: CompletionCandidate): CompletionCandidate {
  return Object.freeze(candidate);
}

export function buildCompletionCandidates(
  macros: readonly AvrMacro[]
): readonly CompletionCandidate[] {
  const candidates = new Map<string, CompletionCandidate>();

  for (const instruction of INSTRUCTIONS) {
    candidates.set(instruction, frozenCandidate({
      label: instruction,
      detail: "AVR instruction",
      kind: "instruction"
    }));
  }
  for (const register of [...REGISTERS, ...POINTER_REGISTERS]) {
    candidates.set(register, frozenCandidate({
      label: register,
      detail: "AVR register",
      kind: "register"
    }));
  }
  for (const directive of DIRECTIVES) {
    candidates.set(directive, frozenCandidate({
      label: directive,
      detail: "GNU assembler directive",
      kind: "directive"
    }));
  }
  for (const macro of macros) {
    if (!candidates.has(macro.name)) {
      const suffix = macro.expansion.length > 0 ? ` — ${macro.expansion}` : "";
      candidates.set(macro.name, frozenCandidate({
        label: macro.name,
        detail: `AVR device macro${suffix}`,
        kind: "device"
      }));
    }
  }

  return Object.freeze(
    [...candidates.values()].sort((left, right) => left.label.localeCompare(right.label))
  );
}
