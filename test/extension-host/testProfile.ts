import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestProfile {
  readonly rootPath: string;
  readonly launchArgs: readonly string[];
}

export async function createTestProfile(
  label: "source" | "packaged" | "restricted"
): Promise<TestProfile> {
  const rootPath = await mkdtemp(join(tmpdir(), `avr-asm-${label}-`));
  return Object.freeze({
    rootPath,
    launchArgs: Object.freeze([
      `--extensions-dir=${join(rootPath, "extensions")}`,
      `--user-data-dir=${join(rootPath, "user-data")}`
    ])
  });
}

export async function disposeTestProfile(profile: TestProfile): Promise<void> {
  await rm(profile.rootPath, { recursive: true, force: true });
}
