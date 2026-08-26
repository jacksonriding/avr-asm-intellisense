import type { AvrMacro, CompletionCandidate } from "./types";
import { AVR_INSTRUCTIONS, type AvrInstruction } from "./instructions";

const REGISTERS = Array.from({ length: 32 }, (_, index) => `r${index}`);
const POINTER_REGISTERS = ["X", "Y", "Z"] as const;
const DIRECTIVES = [
  ".byte", ".data", ".equ", ".global", ".macro", ".section", ".set", ".text", ".word"
] as const;

function frozenCandidate(candidate: CompletionCandidate): CompletionCandidate {
  return Object.freeze(candidate);
}

function instructionDocumentation(instruction: AvrInstruction): string {
  const operandLines = instruction.forms.flatMap(({ operands }) => operands).filter(
    (operand, index, operands) => operands.findIndex(({ label }) => label === operand.label) === index
  ).map(({ label, description }) => `**${label}:** ${description}`);
  return [
    instruction.summary,
    ...operandLines,
    `Availability: ${instruction.availability}`
  ].join("\n\n");
}

export function buildCompletionCandidates(
  macros: readonly AvrMacro[]
): readonly CompletionCandidate[] {
  const candidates = new Map<string, CompletionCandidate>();

  for (const instruction of AVR_INSTRUCTIONS) {
    candidates.set(instruction.mnemonic, frozenCandidate({
      label: instruction.mnemonic,
      detail: `${instruction.forms[0]?.syntax ?? instruction.mnemonic} — ${instruction.summary}`,
      kind: "instruction",
      documentation: instructionDocumentation(instruction)
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
