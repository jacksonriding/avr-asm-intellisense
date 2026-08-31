import { chmod, cp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { runVSCodeCommand } from "@vscode/test-electron";

import {
  forbiddenToolScript,
  restrictedCompileCommandsFixture,
  restrictedTestLaunchArgs
} from "./restrictedTestLaunch";
import { createTestProfile, disposeTestProfile } from "./testProfile";

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, "../..");
  const extensionTestsPath = resolve(__dirname, "index");
  const fixturePath = resolve(extensionDevelopmentPath, "test/fixtures/basic-workspace");
  const version = process.env.VSCODE_TEST_VERSION ?? "stable";
  const profile = await createTestProfile("restricted");
  const workspacePath = join(profile.rootPath, "workspace");
  const toolchainDirectory = join(profile.rootPath, "toolchain");
  const forbiddenCompilerPath = join(toolchainDirectory, "avr-gcc");
  const forbiddenToolMarkerPath = join(profile.rootPath, "forbidden-tool-launched.txt");
  const userSettingsDirectory = join(profile.rootPath, "user-data", "User");

  try {
    await Promise.all([
      cp(fixturePath, workspacePath, { recursive: true }),
      mkdir(toolchainDirectory, { recursive: true }),
      mkdir(userSettingsDirectory, { recursive: true })
    ]);
    await writeFile(
      forbiddenCompilerPath,
      forbiddenToolScript(forbiddenToolMarkerPath),
      { encoding: "utf8", mode: 0o755 }
    );
    await chmod(forbiddenCompilerPath, 0o755);
    await writeFile(
      join(workspacePath, "compile_commands.json"),
      restrictedCompileCommandsFixture({
        workspacePath,
        compilerPath: forbiddenCompilerPath
      }),
      "utf8"
    );
    await writeFile(
      join(userSettingsDirectory, "settings.json"),
      JSON.stringify({
        "security.workspace.trust.enabled": true,
        "security.workspace.trust.startupPrompt": "never"
      }),
      "utf8"
    );

    await runVSCodeCommand(restrictedTestLaunchArgs({
      workspacePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      profileArgs: profile.launchArgs
    }), {
      version,
      spawn: {
        env: {
          ...process.env,
          AVR_ASM_EXTENSION_MODE: "development",
          AVR_ASM_FORBIDDEN_TOOL_MARKER: forbiddenToolMarkerPath,
          AVR_ASM_EXPECTED_WORKSPACE_TRUST: "restricted"
        },
        stdio: "inherit",
        windowsHide: true
      }
    });
  } finally {
    await disposeTestProfile(profile);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
