import type { CompileCommandContext } from "./compileCommands";
import type { PlatformioCompilationContext } from "./platformioMetadata";

export type CompilationContextSource =
  | "manual"
  | "compileCommands"
  | "platformio"
  | "platformioIni";

export interface CompilationContext {
  readonly dialect: "gnu-avr";
  readonly source: CompilationContextSource;
  readonly compilerPath: string;
  readonly mcu: string;
  readonly defines: readonly string[];
  readonly undefines: readonly string[];
  readonly includePaths: readonly string[];
  readonly workingDirectory?: string;
  readonly environmentName?: string;
}

export interface CompilationContextSources {
  readonly configuredCompilerPath?: string;
  readonly configuredMcu?: string;
  readonly compileCommand?: CompileCommandContext;
  readonly platformio?: PlatformioCompilationContext;
  readonly iniMcu?: string;
}

interface BaseContext {
  readonly source: "compileCommands" | "platformio";
  readonly compilerPath: string;
  readonly mcu: string;
  readonly defines: readonly string[];
  readonly undefines: readonly string[];
  readonly includePaths: readonly string[];
  readonly workingDirectory?: string;
  readonly environmentName?: string;
}

function freezeValues(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function selectBase(sources: CompilationContextSources): BaseContext | undefined {
  if (sources.compileCommand !== undefined) {
    return {
      source: "compileCommands",
      compilerPath: sources.compileCommand.compilerPath,
      mcu: sources.compileCommand.mcu,
      defines: sources.compileCommand.defines,
      undefines: sources.compileCommand.undefines,
      includePaths: sources.compileCommand.includePaths,
      workingDirectory: sources.compileCommand.workingDirectory
    };
  }
  if (sources.platformio !== undefined) {
    return {
      source: "platformio",
      compilerPath: sources.platformio.compilerPath,
      mcu: sources.platformio.mcu,
      defines: sources.platformio.defines,
      undefines: [],
      includePaths: sources.platformio.includePaths,
      environmentName: sources.platformio.environmentName
    };
  }
  return undefined;
}

export function resolveCompilationContext(
  sources: CompilationContextSources
): CompilationContext | undefined {
  const configuredCompilerPath = sources.configuredCompilerPath?.trim() ?? "";
  const configuredMcu = sources.configuredMcu?.trim() ?? "";
  const iniMcu = sources.iniMcu?.trim() ?? "";
  const base = selectBase(sources);
  const mcu = configuredMcu || base?.mcu || iniMcu;
  if (mcu.length === 0) {
    return undefined;
  }

  const hasManualSetting = configuredCompilerPath.length > 0 || configuredMcu.length > 0;
  const baseMatchesMcu = base?.mcu === mcu;
  const source: CompilationContextSource = hasManualSetting
    ? "manual"
    : (base?.source ?? "platformioIni");
  const shared = {
    dialect: "gnu-avr" as const,
    source,
    compilerPath: configuredCompilerPath || base?.compilerPath || "avr-gcc",
    mcu,
    defines: freezeValues(baseMatchesMcu ? (base?.defines ?? []) : []),
    undefines: freezeValues(baseMatchesMcu ? (base?.undefines ?? []) : []),
    includePaths: freezeValues(baseMatchesMcu ? (base?.includePaths ?? []) : [])
  };
  const optional = baseMatchesMcu && base !== undefined
    ? {
        ...(base.workingDirectory === undefined ? {} : { workingDirectory: base.workingDirectory }),
        ...(base.environmentName === undefined ? {} : { environmentName: base.environmentName })
      }
    : {};
  return Object.freeze({ ...shared, ...optional });
}

const SOURCE_LABELS: Readonly<Record<CompilationContextSource, string>> = {
  manual: "manual settings",
  compileCommands: "compile_commands.json",
  platformio: "PlatformIO metadata",
  platformioIni: "platformio.ini"
};

export function formatActiveContext(context: CompilationContext | undefined): string {
  if (context === undefined) {
    return "No active AVR device context. Static completions remain available.";
  }
  const lines = [
    "AVR Assembly active context",
    `Source: ${SOURCE_LABELS[context.source]}`,
    "Dialect: GNU AVR",
    `MCU: ${context.mcu}`,
    `Compiler: ${context.compilerPath}`
  ];
  if (context.environmentName !== undefined) {
    lines.push(`Environment: ${context.environmentName}`);
  }
  if (context.workingDirectory !== undefined) {
    lines.push(`Working directory: ${context.workingDirectory}`);
  }
  lines.push(
    `Defines: ${context.defines.length}`,
    `Undefines: ${context.undefines.length}`,
    `Include paths: ${context.includePaths.length}`
  );
  return lines.join("\n");
}
