import { describe, expect, it, vi } from "vitest";

import { ProjectContextService } from "../src/core/projectContext";
import {
  compileCommands,
  contextRequest,
  deferred,
  manualRequest,
  metadataContext,
  serviceHarness
} from "./projectContextSupport";

describe("project context discovery", () => {
  it("resolves manual settings without touching project files", async () => {
    const harness = serviceHarness();
    const service = new ProjectContextService(harness.dependencies);

    await expect(service.resolve(manualRequest())).resolves.toEqual({
      dialect: "gnu-avr",
      source: "manual",
      compilerPath: "/tools/avr-gcc",
      mcu: "atmega328p",
      defines: [],
      undefines: [],
      includePaths: []
    });
    expect(harness.readTextFile).not.toHaveBeenCalled();
    expect(harness.runMetadata).not.toHaveBeenCalled();
  });

  it("gives an exact compilation database entry priority and caches its parse", async () => {
    const harness = serviceHarness();
    harness.readTextFile.mockResolvedValue(compileCommands());
    const service = new ProjectContextService(harness.dependencies);

    const first = await service.resolve(contextRequest());
    const second = await service.resolve(contextRequest());

    expect(first).toMatchObject({
      source: "compileCommands",
      compilerPath: "/tools/avr-gcc",
      mcu: "atmega328p",
      defines: ["PROJECT=1"]
    });
    expect(second).toEqual(first);
    expect(harness.readTextFile).toHaveBeenCalledTimes(1);
    expect(harness.readTextFile).toHaveBeenCalledWith("/workspace/compile_commands.json");
    expect(harness.runMetadata).not.toHaveBeenCalled();
  });

  it("tries only an explicitly configured relative compilation database", async () => {
    const harness = serviceHarness();
    harness.readTextFile.mockResolvedValue(compileCommands());
    const service = new ProjectContextService(harness.dependencies);

    await service.resolve(contextRequest({
      configuration: { compileCommandsPath: "out/commands.json" }
    }));

    expect(harness.readTextFile).toHaveBeenCalledOnce();
    expect(harness.readTextFile).toHaveBeenCalledWith("/workspace/out/commands.json");
  });

  it("falls back from the root compilation database to the build directory", async () => {
    const harness = serviceHarness();
    harness.readTextFile.mockImplementation(async (path) => {
      if (path === "/workspace/build/compile_commands.json") {
        return compileCommands();
      }
      throw new Error("not found");
    });
    const service = new ProjectContextService(harness.dependencies);

    await expect(service.resolve(contextRequest())).resolves.toMatchObject({
      source: "compileCommands",
      mcu: "atmega328p"
    });
    expect(harness.readTextFile.mock.calls.map(([path]) => path)).toEqual([
      "/workspace/compile_commands.json",
      "/workspace/build/compile_commands.json"
    ]);
  });

  it("shares a concurrent compilation database read", async () => {
    const harness = serviceHarness();
    const pending = deferred<string>();
    harness.readTextFile.mockImplementation(async () => await pending.promise);
    const service = new ProjectContextService(harness.dependencies);

    const first = service.resolve(contextRequest());
    const second = service.resolve(contextRequest());
    await vi.waitFor(() => expect(harness.readTextFile).toHaveBeenCalledOnce());
    pending.resolve(compileCommands());

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ source: "compileCommands" }),
      expect.objectContaining({ source: "compileCommands" })
    ]);
    expect(harness.readTextFile).toHaveBeenCalledOnce();
  });

  it("uses PlatformIO metadata before the INI fallback", async () => {
    const harness = serviceHarness();
    harness.readTextFile.mockImplementation(async (path) => {
      if (path.endsWith("platformio.ini")) {
        return "[env:test]\nplatform = atmelavr\nboard_build.mcu = atmega4809\n";
      }
      throw new Error("not found");
    });
    harness.runMetadata.mockResolvedValue([metadataContext("atmega328p")]);
    const service = new ProjectContextService(harness.dependencies);

    await expect(service.resolve(contextRequest())).resolves.toMatchObject({
      source: "platformio",
      compilerPath: "/pio/avr-gcc",
      mcu: "atmega328p",
      defines: ["PLATFORMIO=1"]
    });
  });

  it("uses the INI MCU without launching metadata when metadata is disabled", async () => {
    const harness = serviceHarness();
    harness.readTextFile.mockImplementation(async (path) => {
      if (path.endsWith("platformio.ini")) {
        return "[env:test]\nboard_build.mcu = attiny1626\n";
      }
      throw new Error("not found");
    });
    const service = new ProjectContextService(harness.dependencies);

    await expect(service.resolve(contextRequest({
      configuration: { usePlatformioMetadata: false }
    }))).resolves.toMatchObject({
      source: "platformioIni",
      compilerPath: "avr-gcc",
      mcu: "attiny1626"
    });
    expect(harness.runMetadata).not.toHaveBeenCalled();
  });

  it("retries invalid configured databases while reporting their error once", async () => {
    const harness = serviceHarness();
    harness.readTextFile.mockResolvedValue("not json");
    const service = new ProjectContextService(harness.dependencies);
    const request = contextRequest({
      configuration: {
        compileCommandsPath: "/workspace/custom/compile_commands.json",
        usePlatformioMetadata: false
      }
    });

    await service.resolve(request);
    await service.resolve(request);

    expect(harness.readTextFile.mock.calls.filter(
      ([path]) => path === "/workspace/custom/compile_commands.json"
    )).toHaveLength(2);
    expect(harness.report).toHaveBeenCalledOnce();
    expect(harness.report).toHaveBeenCalledWith(expect.objectContaining({
      category: "compileCommands",
      key: "/workspace/custom/compile_commands.json",
      message: "Configured compilation database is unavailable or invalid."
    }));
  });

  it("keeps all inherited flags only when a manual MCU matches the discovered MCU", async () => {
    const harness = serviceHarness();
    harness.readTextFile.mockResolvedValue(compileCommands());
    const service = new ProjectContextService(harness.dependencies);

    const matching = await service.resolve(contextRequest({
      configuration: { mcu: "atmega328p" }
    }));
    const different = await service.resolve(contextRequest({
      configuration: { mcu: "attiny85" }
    }));

    expect(matching).toMatchObject({ source: "manual", defines: ["PROJECT=1"] });
    expect(different).toMatchObject({
      source: "manual",
      mcu: "attiny85",
      defines: [],
      includePaths: []
    });
  });

  it("bounds compilation database and diagnostic caches", async () => {
    const harness = serviceHarness({ maxEntries: 2 });
    harness.readTextFile.mockImplementation(async (path) => {
      if (path.endsWith("compile_commands.json")) {
        return compileCommands(path.slice(0, -"/compile_commands.json".length));
      }
      throw new Error("not found");
    });
    const service = new ProjectContextService(harness.dependencies, harness.options);

    for (const workspaceRoot of ["/one", "/two", "/three", "/one"]) {
      await service.resolve(contextRequest({ workspaceRoot }));
    }

    expect(harness.readTextFile).toHaveBeenCalledTimes(4);

    harness.report.mockClear();
    harness.readTextFile.mockResolvedValue("invalid");
    for (const name of ["one", "two", "three", "one"]) {
      await service.resolve(contextRequest({
        configuration: {
          compileCommandsPath: `/custom/${name}.json`,
          usePlatformioMetadata: false
        }
      }));
    }
    expect(harness.report).toHaveBeenCalledTimes(4);
  });

  it("does no work for an already cancelled request", async () => {
    const harness = serviceHarness();
    const service = new ProjectContextService(harness.dependencies);
    const controller = new AbortController();
    controller.abort();

    await expect(service.resolve(contextRequest({ signal: controller.signal }))).resolves.toBeUndefined();
    expect(harness.readTextFile).not.toHaveBeenCalled();
    expect(harness.runMetadata).not.toHaveBeenCalled();
    expect(harness.report).not.toHaveBeenCalled();
  });

  it("returns immutable context snapshots", async () => {
    const harness = serviceHarness();
    harness.readTextFile.mockResolvedValue(compileCommands());
    const service = new ProjectContextService(harness.dependencies);

    const context = await service.resolve(contextRequest());

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context?.defines)).toBe(true);
    expect(() => (context?.defines as string[]).push("MUTATED=1")).toThrow();
  });

  it("validates cache limits at construction", () => {
    const harness = serviceHarness();

    expect(() => new ProjectContextService(harness.dependencies, { maxEntries: 0 }))
      .toThrow("maxEntries must be a positive integer.");
    expect(() => new ProjectContextService(harness.dependencies, { metadataTtlMs: -1 }))
      .toThrow("metadataTtlMs must be a non-negative finite number.");
  });
});
