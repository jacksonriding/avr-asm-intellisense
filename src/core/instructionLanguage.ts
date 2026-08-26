import {
  findInstruction,
  type AvrInstruction,
  type AvrInstructionForm
} from "./instructions";

export interface InstructionToken {
  readonly text: string;
  readonly normalized: string;
  readonly start: number;
  readonly end: number;
}

export interface InstructionHover {
  readonly markdown: string;
  readonly start: number;
  readonly end: number;
}

export interface InstructionParameterHelp {
  readonly label: string;
  readonly documentation: string;
}

export interface InstructionSignature {
  readonly label: string;
  readonly documentation: string;
  readonly parameters: readonly InstructionParameterHelp[];
}

export interface InstructionSignatureHelp {
  readonly signatures: readonly InstructionSignature[];
  readonly activeSignature: number;
  readonly activeParameter: number;
}

interface Invocation {
  readonly instruction: AvrInstruction;
  readonly token: InstructionToken;
  readonly codeEnd: number;
}

const INVOCATION_PATTERN = /^\s*(?:(?:[A-Za-z_.$][A-Za-z0-9_.$]*|[0-9]+):\s*)*([A-Za-z]+)\b/u;

function findCommentStart(line: string): number {
  let quote: "\"" | "'" | undefined;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== undefined) {
      escaped = true;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = quote === undefined ? character : (quote === character ? undefined : quote);
      continue;
    }
    if (quote === undefined && (character === ";" || (character === "/" && line[index + 1] === "/"))) {
      return index;
    }
  }
  return line.length;
}

function findInvocation(line: string): Invocation | undefined {
  const codeEnd = findCommentStart(line);
  const code = line.slice(0, codeEnd);
  if (/^\s*#/u.test(code)) {
    return undefined;
  }
  const match = INVOCATION_PATTERN.exec(code);
  const text = match?.[1];
  if (match === null || text === undefined) {
    return undefined;
  }
  const instruction = findInstruction(text);
  if (instruction === undefined) {
    return undefined;
  }
  const relativeStart = match[0].lastIndexOf(text);
  const start = (match.index ?? 0) + relativeStart;
  return Object.freeze({
    instruction,
    token: Object.freeze({ text, normalized: instruction.mnemonic, start, end: start + text.length }),
    codeEnd
  });
}

export function findInstructionToken(line: string, cursor: number): InstructionToken | undefined {
  const invocation = findInvocation(line);
  if (invocation === undefined || cursor < invocation.token.start || cursor >= invocation.token.end) {
    return undefined;
  }
  return invocation.token;
}

function uniqueOperands(instruction: AvrInstruction): readonly InstructionParameterHelp[] {
  const unique = new Map<string, InstructionParameterHelp>();
  for (const { operands } of instruction.forms) {
    for (const operand of operands) {
      if (!unique.has(operand.label)) {
        unique.set(operand.label, Object.freeze({
          label: operand.label,
          documentation: operand.description
        }));
      }
    }
  }
  return Object.freeze([...unique.values()]);
}

function hoverMarkdown(instruction: AvrInstruction): string {
  const operands = uniqueOperands(instruction);
  const formLines = instruction.forms.map(
    ({ syntax, cycles }) => `- \`${syntax}\` — **Cycles:** ${cycles}`
  );
  const operandLines = operands.length === 0 ? [] : [
    "",
    "**Operands**",
    "",
    ...operands.map(({ label, documentation }) => `- **${label}** — ${documentation}`)
  ];
  const aliasLine = instruction.aliasOf === undefined
    ? []
    : [
      `**Alias of:** \`${instruction.aliasOf}\``,
      ...(instruction.equivalentTo === undefined
        ? []
        : [`**Equivalent instruction:** \`${instruction.equivalentTo}\``])
    ];
  return [
    `### \`${instruction.mnemonic}\``,
    "",
    instruction.summary,
    "",
    "**Forms**",
    "",
    ...formLines,
    ...operandLines,
    "",
    `**SREG:** ${instruction.statusRegisterEffect}`,
    `**Availability:** ${instruction.availability}`,
    ...aliasLine,
    "",
    `[Microchip AVR Instruction Set Manual](${instruction.documentationUrl})`
  ].join("\n");
}

export function buildInstructionHover(line: string, cursor: number): InstructionHover | undefined {
  const token = findInstructionToken(line, cursor);
  if (token === undefined) {
    return undefined;
  }
  const instruction = findInstruction(token.normalized);
  if (instruction === undefined) {
    return undefined;
  }
  return Object.freeze({ markdown: hoverMarkdown(instruction), start: token.start, end: token.end });
}

function splitOperands(value: string): readonly string[] {
  if (value.trim().length === 0) {
    return Object.freeze([]);
  }
  const operands: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "\"" | "'" | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\"" || character === "'") {
      quote = quote === undefined ? character : (quote === character ? undefined : quote);
    } else if (quote === undefined && (character === "(" || character === "[" || character === "{")) {
      depth += 1;
    } else if (quote === undefined && (character === ")" || character === "]" || character === "}")) {
      depth = Math.max(0, depth - 1);
    } else if (quote === undefined && character === "," && depth === 0) {
      operands.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  operands.push(value.slice(start).trim());
  return Object.freeze(operands);
}

function pointerScore(form: AvrInstructionForm, values: readonly string[]): number {
  return form.operands.reduce((score, operand, index) => {
    if (!/^-?[XYZ](?:\+|\+q)?$/u.test(operand.label)) {
      return score;
    }
    const value = values[index]?.toUpperCase();
    const label = operand.label.toUpperCase();
    const matchesDisplacement = label.endsWith("+Q")
      && value?.startsWith(label.slice(0, -1)) === true
      && value.length > label.length - 1;
    return score + (value === label || matchesDisplacement ? 2 : -2);
  }, 0);
}

function selectActiveSignature(
  forms: readonly AvrInstructionForm[],
  operands: readonly string[]
): number {
  const exactArity = forms.map((form, index) => ({ form, index })).filter(
    ({ form }) => form.operands.length === operands.length
  );
  const compatibleArity = forms.map((form, index) => ({ form, index })).filter(
    ({ form }) => form.operands.length >= operands.length
  );
  const candidates = exactArity.length > 0
    ? exactArity
    : (compatibleArity.length > 0 ? compatibleArity : forms.map((form, index) => ({ form, index })));
  return candidates.reduce((best, candidate) => {
    const scoreDifference = pointerScore(candidate.form, operands) - pointerScore(best.form, operands);
    if (scoreDifference > 0) return candidate;
    if (scoreDifference < 0) return best;
    return candidate.form.operands.length < best.form.operands.length ? candidate : best;
  }).index;
}

function activeOperandIndex(value: string): number {
  return Math.max(0, splitOperands(value).length - 1);
}

export function getInstructionSignatureHelp(
  line: string,
  cursor: number
): InstructionSignatureHelp | undefined {
  const invocation = findInvocation(line);
  if (invocation === undefined || cursor < invocation.token.end || cursor > invocation.codeEnd) {
    return undefined;
  }
  const operandStart = invocation.token.end;
  const operandTextAtCursor = line.slice(operandStart, Math.min(cursor, invocation.codeEnd));
  const operands = splitOperands(operandTextAtCursor.trim());
  const signatures = Object.freeze(invocation.instruction.forms.map((form) => Object.freeze({
    label: form.syntax,
    documentation: `${invocation.instruction.summary} Cycles: ${form.cycles}.`,
    parameters: Object.freeze(form.operands.map((operand) => Object.freeze({
      label: operand.label,
      documentation: operand.description
    })))
  })));
  const activeSignature = selectActiveSignature(invocation.instruction.forms, operands);
  const activeSignatureParameterCount = signatures[activeSignature]?.parameters.length ?? 0;
  return Object.freeze({
    signatures,
    activeSignature,
    activeParameter: Math.min(
      activeOperandIndex(operandTextAtCursor),
      Math.max(0, activeSignatureParameterCount - 1)
    )
  });
}
