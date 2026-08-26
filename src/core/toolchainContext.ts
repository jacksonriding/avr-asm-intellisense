import type { PlatformioCompilationContext } from "./platformioMetadata";

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
  const configuredMcu = sources.configuredMcu?.trim() ?? "";
  const metadataMcu = sources.metadata?.mcu ?? "";
  const iniMcu = sources.iniMcu?.trim() ?? "";
  const mcu = configuredMcu || metadataMcu || iniMcu;
  if (mcu.length === 0) {
    return undefined;
  }

  const configuredCompilerPath = sources.configuredCompilerPath?.trim() ?? "";
  const compilerPath = configuredCompilerPath || sources.metadata?.compilerPath || "avr-gcc";
  const metadataMatchesMcu = sources.metadata?.mcu === mcu;

  return Object.freeze({
    compilerPath,
    mcu,
    defines: metadataMatchesMcu ? Object.freeze([...sources.metadata.defines]) : Object.freeze([]),
    includePaths: metadataMatchesMcu
      ? Object.freeze([...sources.metadata.includePaths])
      : Object.freeze([])
  });
}
