import { describe, expect, it } from "vitest";

import { parseCompilationDatabase } from "../src/core/compileCommands";
import {
  forbiddenToolScript,
  restrictedCompileCommandsFixture,
  restrictedTestLaunchArgs
} from "./extension-host/restrictedTestLaunch";

describe("Restricted Mode Extension Host launch", () => {
  it("mirrors Extension Host test defaults without disabling workspace trust", () => {
    const args = restrictedTestLaunchArgs({
      workspacePath: "/tmp/workspace",
      extensionDevelopmentPath: "/repo",
      extensionTestsPath: "/repo/out/extension-host/index",
      profileArgs: [
        "--extensions-dir=/tmp/extensions",
        "--user-data-dir=/tmp/user-data"
      ]
    });

    expect(args).toEqual([
      "/tmp/workspace",
      "--no-sandbox",
      "--disable-gpu-sandbox",
      "--disable-updates",
      "--skip-welcome",
      "--skip-release-notes",
      "--no-cached-data",
      "--disable-extensions",
      "--extensionTestsPath=/repo/out/extension-host/index",
      "--extensionDevelopmentPath=/repo",
      "--extensions-dir=/tmp/extensions",
      "--user-data-dir=/tmp/user-data"
    ]);
    expect(args).not.toContain("--disable-workspace-trust");
    expect(Object.isFrozen(args)).toBe(true);
  });

  it.each([
    "--disable-workspace-trust",
    "--disable-workspace-trust=true"
  ])("rejects %s because it would force trusted test behavior", (flag) => {
    expect(() => restrictedTestLaunchArgs({
      workspacePath: "/tmp/workspace",
      extensionDevelopmentPath: "/repo",
      extensionTestsPath: "/repo/out/extension-host/index",
      profileArgs: [flag]
    })).toThrow("Restricted Mode smoke tests must not disable workspace trust.");
  });

  it("builds a compile_commands fixture that would launch only if Restricted Mode is bypassed", () => {
    const content = restrictedCompileCommandsFixture({
      workspacePath: "/tmp/workspace",
      compilerPath: "/tmp/toolchain/avr-gcc"
    });
    const entries = JSON.parse(content) as Array<{
      directory: string;
      file: string;
      arguments: string[];
    }>;

    expect(entries).toEqual([{
      directory: "/tmp/workspace",
      file: "src/main.S",
      arguments: ["/tmp/toolchain/avr-gcc", "-mmcu=atmega328p", "-c", "src/main.S"]
    }]);
    expect(parseCompilationDatabase(content)).toEqual([{
      sourceFile: "/tmp/workspace/src/main.S",
      compilerPath: "/tmp/toolchain/avr-gcc",
      workingDirectory: "/tmp/workspace",
      mcu: "atmega328p",
      defines: [],
      undefines: [],
      includePaths: []
    }]);
  });

  it("builds a forbidden tool script that records accidental execution", () => {
    const script = forbiddenToolScript("/tmp/marker file.txt");

    expect(script).toContain("#!/usr/bin/env node");
    expect(script).toContain("writeFileSync");
    expect(script).toContain(JSON.stringify("/tmp/marker file.txt"));
    expect(script).toContain("\"launched\\n\"");
    expect(script).toContain("process.exit(42);");
  });
});
