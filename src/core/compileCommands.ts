import { basename, isAbsolute, normalize, resolve } from "node:path";

const MAX_DATABASE_BYTES = 8 * 1024 * 1024;
const MAX_DATABASE_ENTRIES = 10_000;
const MAX_ARGUMENTS = 2_048;
const MAX_VALUE_LENGTH = 4_096;
const MCU_PATTERN = /^[A-Za-z0-9_+-]+$/u;
const DEFINE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:=.*)?$/su;
const UNDEFINE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export interface CompileCommandContext {
  readonly sourceFile: string;
  readonly compilerPath: string;
  readonly workingDirectory: string;
  readonly mcu: string;
  readonly defines: readonly string[];
  readonly undefines: readonly string[];
  readonly includePaths: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidText(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_VALUE_LENGTH
    && !/[\0\r\n]/u.test(value);
}

function tokenizeCommand(command: string): readonly string[] | undefined {
  if (command.length > MAX_ARGUMENTS * MAX_VALUE_LENGTH || /[\0\r\n]/u.test(command)) {
    return undefined;
  }

  const tokens: string[] = [];
  let token = "";
  let quote: "'" | "\"" | undefined;
  let escaping = false;
  let hasToken = false;

  for (const character of command) {
    if (escaping) {
      token += character;
      escaping = false;
      hasToken = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      hasToken = true;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) {
        quote = undefined;
      } else {
        token += character;
      }
      hasToken = true;
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      hasToken = true;
      continue;
    }
    if (/\s/u.test(character)) {
      if (hasToken) {
        tokens.push(token);
        token = "";
        hasToken = false;
      }
      continue;
    }
    token += character;
    hasToken = true;
  }

  if (escaping || quote !== undefined || tokens.length >= MAX_ARGUMENTS) {
    return undefined;
  }
  if (hasToken) {
    tokens.push(token);
  }
  return Object.freeze(tokens);
}

function commandArguments(entry: Record<string, unknown>): readonly string[] | undefined {
  if (Array.isArray(entry.arguments)) {
    if (entry.arguments.length === 0 || entry.arguments.length > MAX_ARGUMENTS) {
      return undefined;
    }
    return entry.arguments.every(isValidText)
      ? Object.freeze([...entry.arguments])
      : undefined;
  }
  return isValidText(entry.command) ? tokenizeCommand(entry.command) : undefined;
}

function resolveCommandPath(value: string, directory: string): string {
  if (isAbsolute(value)) {
    return normalize(value);
  }
  return /[/\\]/u.test(value) ? resolve(directory, value) : value;
}

function compilerIndex(args: readonly string[]): number | undefined {
  const wrappers = new Set(["ccache", "ccache.exe", "sccache", "sccache.exe"]);
  const firstName = basename(args[0] ?? "").toLowerCase();
  const index = wrappers.has(firstName) ? 1 : 0;
  const compilerName = basename(args[index] ?? "").toLowerCase();
  return /^avr-g(?:cc|\+\+)(?:\.exe)?$/u.test(compilerName) ? index : undefined;
}

function valueAfter(args: readonly string[], index: number): string | undefined {
  const value = args[index + 1];
  return value !== undefined && isValidText(value) ? value : undefined;
}

function addUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function unsafeArguments(args: readonly string[]): boolean {
  return args.some((argument) => argument.startsWith("@")
    || argument === "-specs"
    || argument.startsWith("-specs=")
    || argument.startsWith("-fplugin"));
}

function parseEntry(value: unknown): CompileCommandContext | undefined {
  if (!isRecord(value) || !isValidText(value.directory) || !isValidText(value.file)) {
    return undefined;
  }
  const args = commandArguments(value);
  if (args === undefined || unsafeArguments(args)) {
    return undefined;
  }
  const selectedCompilerIndex = compilerIndex(args);
  if (selectedCompilerIndex === undefined) {
    return undefined;
  }

  let mcu: string | undefined;
  const defines: string[] = [];
  const undefines: string[] = [];
  const includePaths: string[] = [];
  for (let index = selectedCompilerIndex + 1; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (argument === "-mmcu") {
      const candidate = valueAfter(args, index);
      if (candidate !== undefined && MCU_PATTERN.test(candidate)) {
        mcu = candidate;
      }
      index += 1;
      continue;
    }
    if (argument.startsWith("-mmcu=")) {
      const candidate = argument.slice("-mmcu=".length);
      if (MCU_PATTERN.test(candidate)) {
        mcu = candidate;
      }
      continue;
    }

    const pairedValue = (prefix: "-D" | "-U" | "-I" | "-isystem"): string | undefined => {
      if (argument === prefix) {
        index += 1;
        return valueAfter(args, index - 1);
      }
      return argument.startsWith(prefix) ? argument.slice(prefix.length) : undefined;
    };
    const define = pairedValue("-D");
    if (define !== undefined) {
      if (DEFINE_PATTERN.test(define) && isValidText(define)) {
        addUnique(defines, define);
      }
      continue;
    }
    const undefine = pairedValue("-U");
    if (undefine !== undefined) {
      if (UNDEFINE_PATTERN.test(undefine)) {
        addUnique(undefines, undefine);
      }
      continue;
    }
    const includePath = pairedValue("-I");
    if (includePath !== undefined) {
      if (isValidText(includePath)) {
        addUnique(includePaths, resolve(value.directory, includePath));
      }
      continue;
    }
    const systemIncludePath = pairedValue("-isystem");
    if (systemIncludePath !== undefined && isValidText(systemIncludePath)) {
      addUnique(includePaths, resolve(value.directory, systemIncludePath));
    }
  }

  if (mcu === undefined) {
    return undefined;
  }
  return Object.freeze({
    sourceFile: resolve(value.directory, value.file),
    compilerPath: resolveCommandPath(args[selectedCompilerIndex] ?? "", value.directory),
    workingDirectory: normalize(value.directory),
    mcu,
    defines: Object.freeze(defines),
    undefines: Object.freeze(undefines),
    includePaths: Object.freeze(includePaths)
  });
}

export function parseCompilationDatabase(content: string): readonly CompileCommandContext[] {
  if (Buffer.byteLength(content, "utf8") > MAX_DATABASE_BYTES) {
    throw new Error("Compilation database exceeds the safety limit.");
  }
  let document: unknown;
  try {
    document = JSON.parse(content);
  } catch {
    throw new Error("Invalid compilation database JSON.");
  }
  if (!Array.isArray(document)) {
    throw new Error("Compilation database must be a JSON array.");
  }
  if (document.length > MAX_DATABASE_ENTRIES) {
    throw new Error("Compilation database contains too many entries.");
  }
  return Object.freeze(document.flatMap((entry) => {
    const context = parseEntry(entry);
    return context === undefined ? [] : [context];
  }));
}

export function findCompilationCommand(
  contexts: readonly CompileCommandContext[],
  sourceFile: string
): CompileCommandContext | undefined {
  const requestedFile = normalize(sourceFile);
  return contexts.find((context) => normalize(context.sourceFile) === requestedFile);
}
