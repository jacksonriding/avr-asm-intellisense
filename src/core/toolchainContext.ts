import type { PlatformioCompilationContext } from "./platformioMetadata";
import { resolveCompilationContext } from "./compilationContext";

export interface ResolvedAvrToolchain {
  readonly compilerPath: string;
  readonly mcu: string;
  readonly defines: readonly string[];
  readonly includePaths: readonly string[];
}

export interface AvrToolchainSources {
  readonly configuredCompilerPath?: string;
  readonly configuredMcu?: string;
  readonly metadata?: PlatformioCompilationContext;
  readonly iniMcu?: string;
}

export function resolveAvrToolchain(
  sources: AvrToolchainSources
): ResolvedAvrToolchain | undefined {
  const context = resolveCompilationContext({
    ...(sources.configuredCompilerPath === undefined
      ? {}
      : { configuredCompilerPath: sources.configuredCompilerPath }),
    ...(sources.configuredMcu === undefined ? {} : { configuredMcu: sources.configuredMcu }),
    ...(sources.metadata === undefined ? {} : { platformio: sources.metadata }),
    ...(sources.iniMcu === undefined ? {} : { iniMcu: sources.iniMcu })
  });
  if (context === undefined) {
    return undefined;
  }
  return Object.freeze({
    compilerPath: context.compilerPath,
    mcu: context.mcu,
    defines: context.defines,
    includePaths: context.includePaths
  });
}
