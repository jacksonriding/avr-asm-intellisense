import { describe, expect, it, vi } from "vitest";

import { discoverPlatformioExecutable } from "../src/core/platformioExecutable";

describe("PlatformIO executable discovery", () => {
  it("uses a trimmed configured path without probing", () => {
    const exists = vi.fn<(path: string) => boolean>();

    expect(discoverPlatformioExecutable({
      configuredPath: "  /tools/pio  ",
      customPath: "",
      homeDirectory: "/home/user",
      platform: "linux"
    }, exists)).toBe("/tools/pio");
    expect(exists).not.toHaveBeenCalled();
  });

  it("finds the executable in the PlatformIO IDE custom path", () => {
    const exists = vi.fn((path: string) => path === "/custom/two/platformio");

    expect(discoverPlatformioExecutable({
      configuredPath: "",
      customPath: "/custom/one:/custom/two",
      homeDirectory: "/home/user",
      platform: "linux"
    }, exists)).toBe("/custom/two/platformio");
  });

  it("uses the platform-specific standard installation", () => {
    const exists = vi.fn(() => true);

    expect(discoverPlatformioExecutable({
      configuredPath: "",
      customPath: undefined,
      homeDirectory: "C:\\Users\\user",
      platform: "win32"
    }, exists)).toBe("C:\\Users\\user\\.platformio\\penv\\Scripts\\platformio.exe");
  });

  it("falls back to pio when no installation is found", () => {
    expect(discoverPlatformioExecutable({
      configuredPath: "",
      customPath: undefined,
      homeDirectory: "/home/user",
      platform: "linux"
    }, () => false)).toBe("pio");
  });
});
