import { resolve } from "node:path";

import { runTests } from "@vscode/test-electron";

import { createTestProfile, disposeTestProfile } from "./testProfile";

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolve(__dirname, "../..");
  const extensionTestsPath = resolve(__dirname, "index");
  const workspacePath = resolve(extensionDevelopmentPath, "test/fixtures/basic-workspace");
  const version = process.env.VSCODE_TEST_VERSION ?? "stable";
  const profile = await createTestProfile("source");

  try {
    await runTests({
      version,
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        AVR_ASM_EXTENSION_MODE: "development"
      },
      launchArgs: [
        workspacePath,
        "--disable-extensions",
        ...profile.launchArgs
      ]
    });
  } finally {
    await disposeTestProfile(profile);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
