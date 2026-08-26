export interface AvrInstructionOperand {
  readonly label: string;
  readonly description: string;
  readonly kind: "register" | "immediate" | "address" | "bit" | "pointer";
  readonly registerRange?: AvrRegisterRange;
  readonly numericRange?: AvrNumericRange;
}

export interface AvrRegisterRange {
  readonly first: number;
  readonly last: number;
  readonly step: number;
}

export interface AvrNumericRange {
  readonly min: number;
  readonly max: number;
}

export interface AvrInstructionForm {
  readonly syntax: string;
  readonly operands: readonly AvrInstructionOperand[];
  readonly cycles: string;
}

export interface AvrInstruction {
  readonly mnemonic: string;
  readonly summary: string;
  readonly forms: readonly AvrInstructionForm[];
  readonly statusFlags: readonly string[];
  readonly statusRegisterEffect: string;
  readonly availability: string;
  readonly aliasOf?: string;
  readonly equivalentTo?: string;
  readonly documentationUrl: string;
}

type InstructionRow = readonly [
  mnemonic: string,
  summary: string,
  syntaxes: string,
  flags?: string,
  cycles?: string,
  availability?: string,
  aliasOf?: string
];

const MANUAL_URL = "https://onlinedocs.microchip.com/oxy/GUID-0B644D8F-67E7-49E6-82C9-1B2B9ABE6A0D-en-US-23/index.html";
const COMMON = "Most AVR cores; verify availability and timing for the selected device.";
const CORE_DEPENDENT = "Core-dependent; not available on every AVR core.";
const AVRXM = "AVRxm devices only.";

const UPPER_REGISTER_INSTRUCTIONS = new Set([
  "ANDI", "CBR", "CPI", "LDI", "ORI", "SBCI", "SBR", "SER", "SUBI"
]);
const FRACTIONAL_REGISTER_INSTRUCTIONS = new Set(["FMUL", "FMULS", "FMULSU", "MULSU"]);
const BIT_IO_INSTRUCTIONS = new Set(["CBI", "SBI", "SBIC", "SBIS"]);
const SHORT_BRANCH_INSTRUCTIONS = new Set([
  "BRBC", "BRBS", "BRCC", "BRCS", "BREQ", "BRGE", "BRHC", "BRHS", "BRID",
  "BRIE", "BRLO", "BRLT", "BRMI", "BRNE", "BRPL", "BRSH", "BRTC", "BRTS",
  "BRVC", "BRVS"
]);

const EQUIVALENT_FOR_ALIAS: Readonly<Record<string, string>> = Object.freeze({
  BRCC: "BRBC 0, k", BRCS: "BRBS 0, k", BREQ: "BRBS 1, k", BRGE: "BRBC 4, k",
  BRHC: "BRBC 5, k", BRHS: "BRBS 5, k", BRID: "BRBC 7, k", BRIE: "BRBS 7, k",
  BRLO: "BRBS 0, k", BRLT: "BRBS 4, k", BRMI: "BRBS 2, k", BRNE: "BRBC 1, k",
  BRPL: "BRBC 2, k", BRSH: "BRBC 0, k", BRTC: "BRBC 6, k", BRTS: "BRBS 6, k",
  BRVC: "BRBC 3, k", BRVS: "BRBS 3, k", CBR: "ANDI Rd, 0xFF-K",
  CLC: "BCLR 0", CLZ: "BCLR 1", CLN: "BCLR 2", CLV: "BCLR 3", CLS: "BCLR 4",
  CLH: "BCLR 5", CLT: "BCLR 6", CLI: "BCLR 7", CLR: "EOR Rd, Rd",
  LSL: "ADD Rd, Rd", ROL: "ADC Rd, Rd", SBR: "ORI Rd, K", SEC: "BSET 0",
  SEZ: "BSET 1", SEN: "BSET 2", SEV: "BSET 3", SES: "BSET 4", SEH: "BSET 5",
  SET: "BSET 6", SEI: "BSET 7", SER: "LDI Rd, 0xFF", TST: "AND Rd, Rd"
});

const OPERAND_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  Rd: "Destination register.",
  Rr: "Source register.",
  Rdl: "Even destination register pair r24, r26, r28, or r30.",
  K: "Immediate constant; the permitted range depends on the instruction.",
  k: "Program or data address/displacement encoded by the instruction.",
  A: "I/O address in the instruction's permitted I/O range.",
  b: "Bit number 0–7.",
  s: "Status Register (SREG) bit number 0–7.",
  q: "Constant displacement 0–63.",
  P: "Register pair selected by the instruction.",
  X: "X pointer register (r27:r26).",
  "X+": "X pointer register with post-increment.",
  "-X": "X pointer register with pre-decrement.",
  Y: "Y pointer register (r29:r28).",
  "Y+": "Y pointer register with post-increment.",
  "-Y": "Y pointer register with pre-decrement.",
  "Y+q": "Y pointer plus a constant displacement of 0–63.",
  Z: "Z pointer register (r31:r30).",
  "Z+": "Z pointer register with post-increment.",
  "-Z": "Z pointer register with pre-decrement.",
  "Z+q": "Z pointer plus a constant displacement of 0–63."
});

// The union of the 119 unique mnemonics in Microchip's AVR Instruction Set Manual.
// Forms and cycle text intentionally retain core-dependent caveats instead of implying
// that every AVR family implements the same instruction timing.
const ROWS: readonly InstructionRow[] = [
  ["ADC", "Add two registers with carry", "ADC Rd, Rr", "Z,C,N,V,S,H"],
  ["ADD", "Add two registers", "ADD Rd, Rr", "Z,C,N,V,S,H"],
  ["ADIW", "Add an immediate value to a word", "ADIW Rdl, K", "Z,C,N,V,S", "2", CORE_DEPENDENT],
  ["AND", "Bitwise AND two registers", "AND Rd, Rr", "Z,N,V,S"],
  ["ANDI", "Bitwise AND a register with an immediate value", "ANDI Rd, K", "Z,N,V,S"],
  ["ASR", "Arithmetic shift right", "ASR Rd", "Z,C,N,V,S"],
  ["BCLR", "Clear a Status Register bit", "BCLR s"],
  ["BLD", "Load a register bit from the T flag", "BLD Rd, b"],
  ["BRBC", "Branch if a Status Register bit is clear", "BRBC s, k", "", "1 if not taken; 2 if taken"],
  ["BRBS", "Branch if a Status Register bit is set", "BRBS s, k", "", "1 if not taken; 2 if taken"],
  ["BRCC", "Branch if carry is clear", "BRCC k", "", "1 if not taken; 2 if taken", COMMON, "BRBC"],
  ["BRCS", "Branch if carry is set", "BRCS k", "", "1 if not taken; 2 if taken", COMMON, "BRBS"],
  ["BREAK", "Enter the on-chip debug break state", "BREAK", "", "1", "AVRe, AVRxm, AVRxt, and AVRrc."],
  ["BREQ", "Branch if equal", "BREQ k", "", "1 if not taken; 2 if taken", COMMON, "BRBS"],
  ["BRGE", "Branch if signed greater than or equal", "BRGE k", "", "1 if not taken; 2 if taken", COMMON, "BRBC"],
  ["BRHC", "Branch if half carry is clear", "BRHC k", "", "1 if not taken; 2 if taken", COMMON, "BRBC"],
  ["BRHS", "Branch if half carry is set", "BRHS k", "", "1 if not taken; 2 if taken", COMMON, "BRBS"],
  ["BRID", "Branch if global interrupts are disabled", "BRID k", "", "1 if not taken; 2 if taken", COMMON, "BRBC"],
  ["BRIE", "Branch if global interrupts are enabled", "BRIE k", "", "1 if not taken; 2 if taken", COMMON, "BRBS"],
  ["BRLO", "Branch if unsigned lower", "BRLO k", "", "1 if not taken; 2 if taken", COMMON, "BRCS"],
  ["BRLT", "Branch if signed less than", "BRLT k", "", "1 if not taken; 2 if taken", COMMON, "BRBS"],
  ["BRMI", "Branch if minus", "BRMI k", "", "1 if not taken; 2 if taken", COMMON, "BRBS"],
  ["BRNE", "Branch if not equal", "BRNE k", "", "1 if not taken; 2 if taken", COMMON, "BRBC"],
  ["BRPL", "Branch if plus", "BRPL k", "", "1 if not taken; 2 if taken", COMMON, "BRBC"],
  ["BRSH", "Branch if unsigned same or higher", "BRSH k", "", "1 if not taken; 2 if taken", COMMON, "BRCC"],
  ["BRTC", "Branch if the T flag is clear", "BRTC k", "", "1 if not taken; 2 if taken", COMMON, "BRBC"],
  ["BRTS", "Branch if the T flag is set", "BRTS k", "", "1 if not taken; 2 if taken", COMMON, "BRBS"],
  ["BRVC", "Branch if overflow is clear", "BRVC k", "", "1 if not taken; 2 if taken", COMMON, "BRBC"],
  ["BRVS", "Branch if overflow is set", "BRVS k", "", "1 if not taken; 2 if taken", COMMON, "BRBS"],
  ["BSET", "Set a Status Register bit", "BSET s"],
  ["BST", "Store a register bit in the T flag", "BST Rr, b", "T"],
  ["CALL", "Call an absolute subroutine address", "CALL k", "", "AVRe 4/5; AVRxm 3/4; AVRxt 3/4; AVRrc N/A", CORE_DEPENDENT],
  ["CBI", "Clear a bit in an I/O register", "CBI A, b", "", "1–2 (core-dependent)"],
  ["CBR", "Clear selected bits in a register", "CBR Rd, K", "Z,N,V,S", "1", COMMON, "ANDI"],
  ["CLC", "Clear the carry flag", "CLC", "C", "1", COMMON, "BCLR"],
  ["CLH", "Clear the half-carry flag", "CLH", "H", "1", COMMON, "BCLR"],
  ["CLI", "Clear the global interrupt flag", "CLI", "I", "1", COMMON, "BCLR"],
  ["CLN", "Clear the negative flag", "CLN", "N", "1", COMMON, "BCLR"],
  ["CLR", "Clear a register", "CLR Rd", "Z,N,V,S", "1", COMMON, "EOR"],
  ["CLS", "Clear the signed-test flag", "CLS", "S", "1", COMMON, "BCLR"],
  ["CLT", "Clear the bit-copy flag", "CLT", "T", "1", COMMON, "BCLR"],
  ["CLV", "Clear the overflow flag", "CLV", "V", "1", COMMON, "BCLR"],
  ["CLZ", "Clear the zero flag", "CLZ", "Z", "1", COMMON, "BCLR"],
  ["COM", "Take the one's complement of a register", "COM Rd", "Z,C,N,V,S"],
  ["CP", "Compare two registers", "CP Rd, Rr", "Z,C,N,V,S,H"],
  ["CPC", "Compare two registers with carry", "CPC Rd, Rr", "Z,C,N,V,S,H"],
  ["CPI", "Compare a register with an immediate value", "CPI Rd, K", "Z,C,N,V,S,H"],
  ["CPSE", "Compare registers and skip if equal", "CPSE Rd, Rr", "", "1–3 (depends on skip and instruction width)"],
  ["DEC", "Decrement a register", "DEC Rd", "Z,N,V,S"],
  ["DES", "Perform one round of DES encryption or decryption", "DES K", "", "AVRxm 1/2", AVRXM],
  ["EICALL", "Call an indirect subroutine using EIND:Z", "EICALL", "", "3–4 (core-dependent)", CORE_DEPENDENT],
  ["EIJMP", "Jump indirectly using EIND:Z", "EIJMP", "", "2", CORE_DEPENDENT],
  ["ELPM", "Load from extended program memory", "ELPM|ELPM Rd, Z|ELPM Rd, Z+", "", "3|3|3", CORE_DEPENDENT],
  ["EOR", "Bitwise exclusive OR two registers", "EOR Rd, Rr", "Z,N,V,S"],
  ["FMUL", "Fractional multiply unsigned registers", "FMUL Rd, Rr", "Z,C", "2", CORE_DEPENDENT],
  ["FMULS", "Fractional multiply signed registers", "FMULS Rd, Rr", "Z,C", "2", CORE_DEPENDENT],
  ["FMULSU", "Fractional multiply signed and unsigned registers", "FMULSU Rd, Rr", "Z,C", "2", CORE_DEPENDENT],
  ["ICALL", "Call a subroutine indirectly through Z", "ICALL", "", "2–3 (core-dependent)"],
  ["IJMP", "Jump indirectly through Z", "IJMP", "", "2"],
  ["IN", "Read an I/O register", "IN Rd, A"],
  ["INC", "Increment a register", "INC Rd", "Z,N,V,S"],
  ["JMP", "Jump to an absolute program address", "JMP k", "", "3", CORE_DEPENDENT],
  ["LAC", "Load through Z and clear selected memory bits", "LAC Z, Rd", "", "2", AVRXM],
  ["LAS", "Load through Z and set selected memory bits", "LAS Z, Rd", "", "2", AVRXM],
  ["LAT", "Load through Z and toggle selected memory bits", "LAT Z, Rd", "", "2", AVRXM],
  ["LD", "Load a byte through a pointer register", "LD Rd, X|LD Rd, X+|LD Rd, -X|LD Rd, Y|LD Rd, Y+|LD Rd, -Y|LD Rd, Z|LD Rd, Z+|LD Rd, -Z", "", "1–3 (form and core-dependent)"],
  ["LDD", "Load a byte through Y or Z with displacement", "LDD Rd, Y+q|LDD Rd, Z+q", "", "1–3 (form and core-dependent)"],
  ["LDI", "Load an immediate value", "LDI Rd, K"],
  ["LDS", "Load a byte from a direct data-space address", "LDS Rd, k", "", "1–3 (encoding and core-dependent)"],
  ["LPM", "Load from program memory", "LPM|LPM Rd, Z|LPM Rd, Z+", "", "3|3|3", CORE_DEPENDENT],
  ["LSL", "Logical shift left", "LSL Rd", "Z,C,N,V,S,H", "1", COMMON, "ADD"],
  ["LSR", "Logical shift right", "LSR Rd", "Z,C,N,V,S"],
  ["MOV", "Copy one register to another", "MOV Rd, Rr"],
  ["MOVW", "Copy one register pair to another", "MOVW Rd, Rr", "", "1", CORE_DEPENDENT],
  ["MUL", "Multiply unsigned registers", "MUL Rd, Rr", "Z,C", "2", CORE_DEPENDENT],
  ["MULS", "Multiply signed registers", "MULS Rd, Rr", "Z,C", "2", CORE_DEPENDENT],
  ["MULSU", "Multiply signed and unsigned registers", "MULSU Rd, Rr", "Z,C", "2", CORE_DEPENDENT],
  ["NEG", "Take the two's complement of a register", "NEG Rd", "Z,C,N,V,S,H"],
  ["NOP", "Perform no operation", "NOP"],
  ["OR", "Bitwise OR two registers", "OR Rd, Rr", "Z,N,V,S"],
  ["ORI", "Bitwise OR a register with an immediate value", "ORI Rd, K", "Z,N,V,S"],
  ["OUT", "Write an I/O register", "OUT A, Rr"],
  ["POP", "Pop a register from the stack", "POP Rd", "", "AVRe/AVRxm/AVRxt 2; AVRrc 3"],
  ["PUSH", "Push a register onto the stack", "PUSH Rr", "", "1–3 (core-dependent)"],
  ["RCALL", "Call a relative subroutine address", "RCALL k", "", "2–4 (core-dependent)"],
  ["RET", "Return from a subroutine", "RET", "", "AVRe/AVRxm/AVRxt 4/5; AVRrc 6"],
  ["RETI", "Return from an interrupt", "RETI", "I", "AVRe/AVRxm/AVRxt 4/5; AVRrc 6"],
  ["RJMP", "Jump to a relative program address", "RJMP k", "", "2"],
  ["ROL", "Rotate left through carry", "ROL Rd", "Z,C,N,V,S,H", "1", COMMON, "ADC"],
  ["ROR", "Rotate right through carry", "ROR Rd", "Z,C,N,V,S"],
  ["SBC", "Subtract registers with carry", "SBC Rd, Rr", "Z,C,N,V,S,H"],
  ["SBCI", "Subtract an immediate value with carry", "SBCI Rd, K", "Z,C,N,V,S,H"],
  ["SBI", "Set a bit in an I/O register", "SBI A, b", "", "1–2 (core-dependent)"],
  ["SBIC", "Skip if an I/O bit is clear", "SBIC A, b", "", "1–4 (skip, width, and core-dependent)"],
  ["SBIS", "Skip if an I/O bit is set", "SBIS A, b", "", "1–4 (skip, width, and core-dependent)"],
  ["SBIW", "Subtract an immediate value from a word", "SBIW Rdl, K", "Z,C,N,V,S", "2", CORE_DEPENDENT],
  ["SBR", "Set selected bits in a register", "SBR Rd, K", "Z,N,V,S", "1", COMMON, "ORI"],
  ["SBRC", "Skip if a register bit is clear", "SBRC Rr, b", "", "1–3 (depends on skip and instruction width)"],
  ["SBRS", "Skip if a register bit is set", "SBRS Rr, b", "", "1–3 (depends on skip and instruction width)"],
  ["SEC", "Set the carry flag", "SEC", "C", "1", COMMON, "BSET"],
  ["SEH", "Set the half-carry flag", "SEH", "H", "1", COMMON, "BSET"],
  ["SEI", "Set the global interrupt flag", "SEI", "I", "1", COMMON, "BSET"],
  ["SEN", "Set the negative flag", "SEN", "N", "1", COMMON, "BSET"],
  ["SER", "Set all bits in a register", "SER Rd", "", "1", COMMON, "LDI"],
  ["SES", "Set the signed-test flag", "SES", "S", "1", COMMON, "BSET"],
  ["SET", "Set the bit-copy flag", "SET", "T", "1", COMMON, "BSET"],
  ["SEV", "Set the overflow flag", "SEV", "V", "1", COMMON, "BSET"],
  ["SEZ", "Set the zero flag", "SEZ", "Z", "1", COMMON, "BSET"],
  ["SLEEP", "Enter the configured sleep mode", "SLEEP"],
  ["SPM", "Store a page buffer or program memory page", "SPM|SPM Z+", "", "Device-dependent|Device-dependent", CORE_DEPENDENT],
  ["ST", "Store a byte through a pointer register", "ST X, Rr|ST X+, Rr|ST -X, Rr|ST Y, Rr|ST Y+, Rr|ST -Y, Rr|ST Z, Rr|ST Z+, Rr|ST -Z, Rr", "", "1–3 (form and core-dependent)"],
  ["STD", "Store a byte through Y or Z with displacement", "STD Y+q, Rr|STD Z+q, Rr", "", "1–3 (form and core-dependent)"],
  ["STS", "Store a byte at a direct data-space address", "STS k, Rr", "", "1–3 (encoding and core-dependent)"],
  ["SUB", "Subtract one register from another", "SUB Rd, Rr", "Z,C,N,V,S,H"],
  ["SUBI", "Subtract an immediate value", "SUBI Rd, K", "Z,C,N,V,S,H"],
  ["SWAP", "Swap the nibbles in a register", "SWAP Rd"],
  ["TST", "Test a register for zero or minus", "TST Rd", "Z,N,V,S", "1", COMMON, "AND"],
  ["WDR", "Reset the watchdog timer", "WDR"],
  ["XCH", "Exchange a register with data memory through Z", "XCH Z, Rd", "", "2", AVRXM]
];

function frozenRegisterRange(first: number, last: number, step = 1): AvrRegisterRange {
  return Object.freeze({ first, last, step });
}

function frozenNumericRange(min: number, max: number): AvrNumericRange {
  return Object.freeze({ min, max });
}

function registerRangeFor(mnemonic: string, label: string): AvrRegisterRange | undefined {
  if (label === "Rdl") return frozenRegisterRange(24, 30, 2);
  if (label !== "Rd" && label !== "Rr") return undefined;
  if (FRACTIONAL_REGISTER_INSTRUCTIONS.has(mnemonic)) return frozenRegisterRange(16, 23);
  if (mnemonic === "MULS" || UPPER_REGISTER_INSTRUCTIONS.has(mnemonic)) {
    return frozenRegisterRange(16, 31);
  }
  if (mnemonic === "MOVW") return frozenRegisterRange(0, 30, 2);
  return frozenRegisterRange(0, 31);
}

function numericRangeFor(mnemonic: string, label: string): AvrNumericRange | undefined {
  if (label === "b" || label === "s") return frozenNumericRange(0, 7);
  if (label === "q") return frozenNumericRange(0, 63);
  if (label === "A") return BIT_IO_INSTRUCTIONS.has(mnemonic)
    ? frozenNumericRange(0, 31) : frozenNumericRange(0, 63);
  if (label === "K") {
    if (mnemonic === "DES") return frozenNumericRange(0, 15);
    if (mnemonic === "ADIW" || mnemonic === "SBIW") return frozenNumericRange(0, 63);
    return frozenNumericRange(0, 255);
  }
  if (label === "k" && SHORT_BRANCH_INSTRUCTIONS.has(mnemonic)) {
    return frozenNumericRange(-64, 63);
  }
  if (label === "k" && (mnemonic === "RJMP" || mnemonic === "RCALL")) {
    return frozenNumericRange(-2048, 2047);
  }
  return undefined;
}

function operandDescription(
  mnemonic: string,
  label: string,
  registerRange: AvrRegisterRange | undefined,
  numericRange: AvrNumericRange | undefined
): string {
  if (registerRange !== undefined) {
    const registers = registerRange.step === 1
      ? `r${registerRange.first}–r${registerRange.last}`
      : `even register${mnemonic === "MOVW" ? " pair" : ""} r${registerRange.first}–r${registerRange.last}`;
    return `${label === "Rd" || label === "Rdl" ? "Destination" : "Source"} register ${registers}.`;
  }
  if (numericRange !== undefined) {
    const prefix = label === "A" ? "I/O address" : (label === "k" ? "Relative word displacement" : "Value");
    return `${prefix} ${numericRange.min}–${numericRange.max}.`;
  }
  return OPERAND_DESCRIPTIONS[label] ?? "Operand defined by the instruction form.";
}

function operandsFor(mnemonic: string, syntax: string): readonly AvrInstructionOperand[] {
  const firstSpace = syntax.indexOf(" ");
  if (firstSpace < 0) {
    return Object.freeze([]);
  }
  return Object.freeze(syntax.slice(firstSpace + 1).split(",").map((value) => {
    const label = value.trim();
    const registerRange = registerRangeFor(mnemonic, label);
    const numericRange = numericRangeFor(mnemonic, label);
    const kind = registerRange !== undefined ? "register"
      : (label === "A" || label === "k" ? "address"
        : (numericRange !== undefined ? (label === "b" || label === "s" ? "bit" : "immediate")
          : "pointer"));
    return Object.freeze({
      label,
      description: operandDescription(mnemonic, label, registerRange, numericRange),
      kind,
      ...(registerRange === undefined ? {} : { registerRange }),
      ...(numericRange === undefined ? {} : { numericRange })
    });
  }));
}

function instructionFromRow(row: InstructionRow): AvrInstruction {
  const [mnemonic, summary, syntaxText, flagText = "", cycleText = "1", availability = COMMON,
    aliasOf] = row;
  const syntaxes = syntaxText.split("|");
  const cycles = cycleText.split("|");
  if (cycles.length !== 1 && cycles.length !== syntaxes.length) {
    throw new Error(`Instruction ${mnemonic} must define one cycle value or one per form.`);
  }
  const forms = Object.freeze(syntaxes.map((syntax, index) => Object.freeze({
    syntax,
    operands: operandsFor(mnemonic, syntax),
    cycles: cycles[index] ?? cycles[0] ?? "Device-dependent"
  })));
  const instruction = {
    mnemonic,
    summary,
    forms,
    statusFlags: Object.freeze(flagText.length === 0 ? [] : flagText.split(",")),
    statusRegisterEffect: mnemonic === "BCLR"
      ? "Selected SREG bit (s) is cleared."
      : (mnemonic === "BSET"
        ? "Selected SREG bit (s) is set."
        : (flagText.length === 0 ? "None" : flagText.split(",").join(", "))),
    availability,
    ...(aliasOf === undefined ? {} : { aliasOf }),
    ...(EQUIVALENT_FOR_ALIAS[mnemonic] === undefined
      ? {}
      : { equivalentTo: EQUIVALENT_FOR_ALIAS[mnemonic] }),
    documentationUrl: MANUAL_URL
  };
  return Object.freeze(instruction);
}

export const AVR_INSTRUCTIONS: readonly AvrInstruction[] = Object.freeze(
  ROWS.map(instructionFromRow)
);

const INSTRUCTIONS_BY_MNEMONIC: ReadonlyMap<string, AvrInstruction> = new Map(
  AVR_INSTRUCTIONS.map((instruction) => [instruction.mnemonic, instruction])
);

export function findInstruction(mnemonic: string): AvrInstruction | undefined {
  return INSTRUCTIONS_BY_MNEMONIC.get(mnemonic.toUpperCase());
}
