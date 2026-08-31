export interface RestrictedTestLaunchOptions {
  readonly workspacePath: string;
  readonly extensionDevelopmentPath: string;
  readonly extensionTestsPath: string;
  readonly profileArgs: readonly string[];
}

export interface RestrictedCompileCommandsFixtureOptions {
  readonly workspacePath: string;
  readonly compilerPath: string;
}

const restrictedLaunchDefaults = Object.freeze([
  "--no-sandbox",
  "--disable-gpu-sandbox",
  "--disable-updates",
  "--skip-welcome",
  "--skip-release-notes",
  "--no-cached-data",
  "--disable-extensions"
]);

function hasLaunchArg(args: readonly string[], name: string): boolean {
  return args.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
}

export function restrictedTestLaunchArgs(
  options: RestrictedTestLaunchOptions
): readonly string[] {
  if (hasLaunchArg(options.profileArgs, "disable-workspace-trust")) {
    throw new Error("Restricted Mode smoke tests must not disable workspace trust.");
  }

  return Object.freeze([
    options.workspacePath,
    ...restrictedLaunchDefaults,
    `--extensionTestsPath=${options.extensionTestsPath}`,
    `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`,
    ...options.profileArgs
  ]);
}

export function restrictedCompileCommandsFixture(
  options: RestrictedCompileCommandsFixtureOptions
): string {
  return JSON.stringify([{
    directory: options.workspacePath,
    file: "src/main.S",
    arguments: [options.compilerPath, "-mmcu=atmega328p", "-c", "src/main.S"]
  }]);
}

export function forbiddenToolScript(markerPath: string): string {
  return [
    "#!/usr/bin/env node",
    "const { writeFileSync } = require(\"node:fs\");",
    `writeFileSync(${JSON.stringify(markerPath)}, "launched\\n", "utf8");`,
    "process.exit(42);",
    ""
  ].join("\n");
}
