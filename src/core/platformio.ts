export interface PlatformioEnvironment {
  readonly name: string;
  readonly mcu?: string;
}

export interface PlatformioConfig {
  readonly defaultEnvironmentNames: readonly string[];
  readonly environments: readonly PlatformioEnvironment[];
}

const SECTION_PATTERN = /^\s*\[([^\]]+)\]\s*$/u;
const ASSIGNMENT_PATTERN = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/u;
const COMMENT_PATTERN = /^\s*[;#]/u;

function stripInlineComment(value: string): string {
  const match = /\s[;#]/u.exec(value);
  return (match === null ? value : value.slice(0, match.index)).trim();
}

function parseEnvironmentName(sectionName: string): string | undefined {
  if (sectionName === "env") {
    return "env";
  }
  if (sectionName.startsWith("env:")) {
    return sectionName.slice("env:".length);
  }
  return undefined;
}

function splitEnvironmentList(value: string): readonly string[] {
  return Object.freeze(
    value
      .split(/[,\s]+/u)
      .map((environment) => environment.trim())
      .filter((environment) => environment.length > 0)
  );
}

export function parsePlatformioConfig(content: string): PlatformioConfig {
  let currentSection = "";
  const defaultEnvironmentNames: string[] = [];
  const environments = new Map<string, PlatformioEnvironment>();

  for (const line of content.split(/\r?\n/u)) {
    if (COMMENT_PATTERN.test(line) || line.trim().length === 0) {
      continue;
    }

    const sectionMatch = SECTION_PATTERN.exec(line);
    if (sectionMatch !== null) {
      currentSection = sectionMatch[1] ?? "";
      continue;
    }

    const assignmentMatch = ASSIGNMENT_PATTERN.exec(line);
    if (assignmentMatch === null) {
      continue;
    }

    const key = assignmentMatch[1];
    const value = stripInlineComment(assignmentMatch[2] ?? "");
    if (key === "default_envs" && currentSection === "platformio") {
      defaultEnvironmentNames.push(...splitEnvironmentList(value));
      continue;
    }

    const environmentName = parseEnvironmentName(currentSection);
    if (environmentName !== undefined && key === "board_build.mcu" && value.length > 0) {
      environments.set(environmentName, Object.freeze({ name: environmentName, mcu: value }));
    }
  }

  return Object.freeze({
    defaultEnvironmentNames: Object.freeze([...defaultEnvironmentNames]),
    environments: Object.freeze([...environments.values()])
  });
}

export function selectPlatformioMcu(
  config: PlatformioConfig,
  requestedEnvironment?: string
): string | undefined {
  const environmentsByName = new Map(
    config.environments.map((environment) => [environment.name, environment])
  );
  const requestedNames = requestedEnvironment === undefined || requestedEnvironment.trim().length === 0
    ? config.defaultEnvironmentNames
    : splitEnvironmentList(requestedEnvironment);
  const candidateNames = requestedNames.length > 0
    ? requestedNames
    : config.environments.map((environment) => environment.name);
  const inheritedMcu = environmentsByName.get("env")?.mcu;

  for (const name of candidateNames) {
    const mcu = environmentsByName.get(name)?.mcu ?? inheritedMcu;
    if (mcu !== undefined && mcu.length > 0) {
      return mcu;
    }
  }

  return undefined;
}
