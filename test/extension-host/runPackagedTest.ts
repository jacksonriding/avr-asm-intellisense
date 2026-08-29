import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  downloadAndUnzipVSCode,
  runTests,
  runVSCodeCommand
} from "@vscode/test-electron";

import { createTestProfile, disposeTestProfile } from "./testProfile";

interface ExtensionManifest {
  readonly name: string;
  readonly version: string;
}

function parseManifest(value: unknown): ExtensionManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("package.json must contain an object");
  }
  const manifest = value as { readonly name?: unknown; readonly version?: unknown };
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new Error("package.json must define string name and version fields");
  }
  return Object.freeze({ name: manifest.name, version: manifest.version });
}

async function main(): Promise<void> {
  const extensionRoot = resolve(__dirname, "../..");
  const manifest = parseManifest(JSON.parse(
    await readFile(resolve(extensionRoot, "package.json"), "utf8")
  ));
  const vsixPath = resolve(extensionRoot, `${manifest.name}-${manifest.version}.vsix`);
  const extensionDevelopmentPath = resolve(extensionRoot, "test/extension-host/driver");
  const extensionTestsPath = resolve(__dirname, "index");
  const workspacePath = resolve(extensionRoot, "test/fixtures/basic-workspace");
  const version = process.env.VSCODE_TEST_VERSION ?? "stable";
  const vscodeExecutablePath = await downloadAndUnzipVSCode(version);
  const profile = await createTestProfile("packaged");

  try {
    await runVSCodeCommand([
      "--install-extension",
      vsixPath,
      "--force",
      ...profile.launchArgs
    ], { version });
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        AVR_ASM_EXTENSION_MODE: "production"
      },
      launchArgs: [workspacePath, ...profile.launchArgs]
    });
  } finally {
    await disposeTestProfile(profile);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
