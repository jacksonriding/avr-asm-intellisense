import { describe, expect, it, vi } from "vitest";

import { ProjectContextService } from "../src/core/projectContext";
import type { PlatformioMetadataRequest } from "../src/core/platformioMetadata";
import {
  contextRequest,
  deferred,
  metadataContext,
  serviceHarness
} from "./projectContextSupport";

function platformioOnlyHarness() {
  const harness = serviceHarness({ metadataTtlMs: 100, maxEntries: 2 });
  harness.readTextFile.mockImplementation(async (path) => {
    if (path.endsWith("platformio.ini")) {
      return "[env:test]\nplatform = atmelavr\nboard_build.mcu = atmega4809\n";
    }
    throw new Error("not found");
  });
  return harness;
}

describe("project context cache lifecycle", () => {
  it("reuses metadata before its TTL and refreshes it at expiry", async () => {
    const harness = platformioOnlyHarness();
    harness.runMetadata.mockResolvedValue([metadataContext()]);
    const service = new ProjectContextService(harness.dependencies, harness.options);

    await service.resolve(contextRequest());
    harness.setNow(1_099);
    await service.resolve(contextRequest());
    harness.setNow(1_100);
    await service.resolve(contextRequest());

    expect(harness.runMetadata).toHaveBeenCalledTimes(2);
  });

  it("evicts completed metadata by least-recent use", async () => {
    const harness = platformioOnlyHarness();
    harness.runMetadata.mockImplementation(async (request) => [metadataContext(
      request.projectDir === "/three" ? "attiny1626" : "atmega328p"
    )]);
    const service = new ProjectContextService(harness.dependencies, harness.options);

    for (const workspaceRoot of ["/one", "/two", "/one", "/three", "/one", "/two"]) {
      await service.resolve(contextRequest({ workspaceRoot }));
    }

    expect(harness.runMetadata.mock.calls.map(([request]) => request.projectDir)).toEqual([
      "/one",
      "/two",
      "/three",
      "/two"
    ]);
  });

  it("retries metadata failures, reports once, and preserves the INI fallback", async () => {
    const harness = platformioOnlyHarness();
    harness.runMetadata.mockRejectedValue(new Error("temporary metadata failure"));
    const service = new ProjectContextService(harness.dependencies, harness.options);

    const first = await service.resolve(contextRequest());
    const second = await service.resolve(contextRequest());

    expect(first).toMatchObject({ source: "platformioIni", mcu: "atmega4809" });
    expect(second).toEqual(first);
    expect(harness.runMetadata).toHaveBeenCalledTimes(2);
    expect(harness.report).toHaveBeenCalledOnce();
    expect(harness.report).toHaveBeenCalledWith(expect.objectContaining({
      category: "platformio",
      message: "temporary metadata failure"
    }));

    service.clear();
    await service.resolve(contextRequest());
    expect(harness.report).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight metadata request while allowing one waiter to cancel", async () => {
    const harness = platformioOnlyHarness();
    const pending = deferred<readonly ReturnType<typeof metadataContext>[]>();
    harness.runMetadata.mockImplementation(async () => await pending.promise);
    const service = new ProjectContextService(harness.dependencies, harness.options);
    const firstController = new AbortController();

    const first = service.resolve(contextRequest({ signal: firstController.signal }));
    const second = service.resolve(contextRequest());
    await vi.waitFor(() => expect(harness.runMetadata).toHaveBeenCalledOnce());
    const sharedSignal = (harness.runMetadata.mock.calls[0]?.[0] as PlatformioMetadataRequest).signal;
    firstController.abort();

    await expect(first).resolves.toBeUndefined();
    expect(sharedSignal?.aborted).toBe(false);
    pending.resolve([metadataContext()]);
    await expect(second).resolves.toMatchObject({ source: "platformio" });
    await service.resolve(contextRequest());
    expect(harness.runMetadata).toHaveBeenCalledOnce();
  });

  it("aborts the underlying metadata request after its final waiter cancels", async () => {
    const harness = platformioOnlyHarness();
    harness.runMetadata.mockImplementation(async (request) => await new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }));
    const service = new ProjectContextService(harness.dependencies, harness.options);
    const controller = new AbortController();

    const result = service.resolve(contextRequest({ signal: controller.signal }));
    await vi.waitFor(() => expect(harness.runMetadata).toHaveBeenCalledOnce());
    const signal = (harness.runMetadata.mock.calls[0]?.[0] as PlatformioMetadataRequest).signal;
    controller.abort();

    await expect(result).resolves.toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(harness.report).not.toHaveBeenCalled();
  });

  it("rejects stale metadata completions after clear", async () => {
    const harness = platformioOnlyHarness();
    const oldResult = deferred<readonly ReturnType<typeof metadataContext>[]>();
    const freshResult = deferred<readonly ReturnType<typeof metadataContext>[]>();
    harness.runMetadata
      .mockImplementationOnce(async () => await oldResult.promise)
      .mockImplementationOnce(async () => await freshResult.promise);
    const service = new ProjectContextService(harness.dependencies, harness.options);

    const oldRequest = service.resolve(contextRequest());
    await vi.waitFor(() => expect(harness.runMetadata).toHaveBeenCalledOnce());
    service.clear();
    const freshRequest = service.resolve(contextRequest());
    await vi.waitFor(() => expect(harness.runMetadata).toHaveBeenCalledTimes(2));
    freshResult.resolve([metadataContext("attiny1626")]);
    await expect(freshRequest).resolves.toMatchObject({ mcu: "attiny1626" });
    oldResult.resolve([metadataContext("atmega328p")]);
    await expect(oldRequest).resolves.toBeUndefined();

    await expect(service.resolve(contextRequest())).resolves.toMatchObject({ mcu: "attiny1626" });
    expect(harness.runMetadata).toHaveBeenCalledTimes(2);
  });

  it("rejects stale compilation database reads after clear", async () => {
    const harness = serviceHarness();
    const oldRead = deferred<string>();
    harness.readTextFile
      .mockImplementationOnce(async () => await oldRead.promise)
      .mockRejectedValue(new Error("not found"));
    const service = new ProjectContextService(harness.dependencies);

    const oldRequest = service.resolve(contextRequest());
    await vi.waitFor(() => expect(harness.readTextFile).toHaveBeenCalledOnce());
    service.clear();
    oldRead.resolve(JSON.stringify([{
      directory: "/workspace",
      file: "src/main.S",
      arguments: ["avr-gcc", "-mmcu=atmega328p", "-c", "src/main.S"]
    }]));

    await expect(oldRequest).resolves.toBeUndefined();
  });

  it("disposes idempotently, aborts pending work, and rejects late resolutions", async () => {
    const harness = platformioOnlyHarness();
    harness.runMetadata.mockImplementation(async (request) => await new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }));
    const service = new ProjectContextService(harness.dependencies, harness.options);
    const pending = service.resolve(contextRequest());
    await vi.waitFor(() => expect(harness.runMetadata).toHaveBeenCalledOnce());

    service.dispose();
    service.dispose();

    await expect(pending).resolves.toBeUndefined();
    await expect(service.resolve(contextRequest())).resolves.toBeUndefined();
    expect(harness.runMetadata).toHaveBeenCalledOnce();
  });

  it("evicts only the least-recent pending metadata request at capacity", async () => {
    const harness = platformioOnlyHarness();
    const pendingByProject = new Map<string, ReturnType<typeof deferred<readonly ReturnType<typeof metadataContext>[]>>>();
    harness.runMetadata.mockImplementation(async (request) => {
      const pending = deferred<readonly ReturnType<typeof metadataContext>[]>();
      pendingByProject.set(request.projectDir, pending);
      request.signal?.addEventListener("abort", () => pending.reject(new Error("cancelled")), { once: true });
      return await pending.promise;
    });
    const service = new ProjectContextService(harness.dependencies, harness.options);

    const first = service.resolve(contextRequest({ workspaceRoot: "/one" }));
    const second = service.resolve(contextRequest({ workspaceRoot: "/two" }));
    await vi.waitFor(() => expect(harness.runMetadata).toHaveBeenCalledTimes(2));
    const firstSignal = (harness.runMetadata.mock.calls[0]?.[0] as PlatformioMetadataRequest).signal;
    const secondSignal = (harness.runMetadata.mock.calls[1]?.[0] as PlatformioMetadataRequest).signal;
    const third = service.resolve(contextRequest({ workspaceRoot: "/three" }));
    await vi.waitFor(() => expect(harness.runMetadata).toHaveBeenCalledTimes(3));

    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);
    pendingByProject.get("/two")?.resolve([metadataContext("atmega328p")]);
    pendingByProject.get("/three")?.resolve([metadataContext("attiny1626")]);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toMatchObject({ mcu: "atmega328p" });
    await expect(third).resolves.toMatchObject({ mcu: "attiny1626" });
  });
});
