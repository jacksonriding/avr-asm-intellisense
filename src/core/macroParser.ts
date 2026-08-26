import type { AvrMacro } from "./types";

const DEFINE_PATTERN = /^#define\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/;

export function parseObjectMacros(output: string): readonly AvrMacro[] {
  const definitions = new Map<string, AvrMacro>();

  for (const line of output.split(/\r?\n/u)) {
    const match = DEFINE_PATTERN.exec(line);
    if (match === null) {
      continue;
    }

    const name = match[1];
    const remainder = match[2];
    if (name === undefined || remainder === undefined || remainder.startsWith("(")) {
      continue;
    }

    definitions.set(name, Object.freeze({ name, expansion: remainder.trimStart() }));
  }

  return Object.freeze(
    [...definitions.values()].sort((left, right) => left.name.localeCompare(right.name))
  );
}
