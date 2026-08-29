import { runExtensionHostSmoke } from "./extensionHost.test";

export async function run(): Promise<void> {
  await runExtensionHostSmoke();
}
