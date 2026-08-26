import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registeredProvider: undefined as undefined | {
    provideCompletionItems: (...args: unknown[]) => Promise<Array<{ label: string }>>;
  },
  settings: {} as Record<string, unknown>,
  trusted: false,
  readFile: vi.fn(),
  runMetadata: vi.fn(),
  runPreprocessor: vi.fn()
}));

vi.mock("../src/core/platformioMetadata", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/core/platformioMetadata")>(),
  runPlatformioMetadata: mocks.runMetadata
}));

vi.mock("../src/core/preprocessor", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/core/preprocessor")>(),
  runAvrPreprocessor: mocks.runPreprocessor
}));

vi.mock("vscode", () => {
  class CompletionItem {
    readonly label: string;
    readonly kind: number;
    detail?: string;

    constructor(label: string, kind: number) {
      this.label = label;
      this.kind = kind;
    }
  }

  const disposable = () => ({ dispose: vi.fn() });
  const workspaceUri = {
    scheme: "file",
    fsPath: "/workspace",
    toString: () => "file:///workspace"
  };

  return {
    CompletionItem,
    CompletionItemKind: { Keyword: 1, Variable: 2, Constant: 3 },
    Uri: {
      joinPath: (_base: unknown, name: string) => ({
        scheme: "file",
        fsPath: `/workspace/${name}`,
        toString: () => `file:///workspace/${name}`
      })
    },
    languages: {
      registerCompletionItemProvider: (_language: string, provider: typeof mocks.registeredProvider) => {
        mocks.registeredProvider = provider;
        return disposable();
      }
    },
    window: {
      createOutputChannel: () => ({ appendLine: vi.fn(), dispose: vi.fn() })
    },
    workspace: {
      get isTrusted() { return mocks.trusted; },
      fs: { readFile: mocks.readFile },
      getConfiguration: (section: string) => ({
        get: (key: string, fallback: unknown) => section === "platformio-ide"
          ? fallback
          : (mocks.settings[key] ?? fallback)
      }),
      getWorkspaceFolder: () => ({ uri: workspaceUri }),
      onDidChangeConfiguration: () => disposable(),
      createFileSystemWatcher: () => ({
        ...disposable(),
        onDidChange: () => disposable(),
        onDidCreate: () => disposable(),
        onDidDelete: () => disposable()
      })
    }
  };
});

import { activate } from "../src/extension";

const document = {
  uri: {
    scheme: "file",
    fsPath: "/workspace/src/main.S",
    toString: () => "file:///workspace/src/main.S"
  },
  version: 1,
  getText: () => "#include <avr/io.h>\nldi r16, 0"
};
const position = {};
const activeToken = { isCancellationRequested: false };

describe("extension integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registeredProvider = undefined;
    mocks.settings = {};
    mocks.trusted = false;
    activate({ subscriptions: [] } as never);
  });

  it("returns static completions without reading or executing in an untrusted workspace", async () => {
    const completions = await mocks.registeredProvider?.provideCompletionItems(
      document,
      position,
      activeToken
    );

    expect(completions?.some(({ label }) => label === "LDI")).toBe(true);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.runMetadata).not.toHaveBeenCalled();
    expect(mocks.runPreprocessor).not.toHaveBeenCalled();
  });

  it("passes generic QUTy metadata into trusted AVR preprocessing", async () => {
    mocks.trusted = true;
    mocks.settings = { usePlatformioMetadata: true };
    mocks.readFile.mockResolvedValue(Buffer.from("[env:QUTy]\nplatform = quty\nboard = QUTy\n"));
    mocks.runMetadata.mockResolvedValue([{
      environmentName: "QUTy",
      compilerPath: "/pio/avr-gcc",
      mcu: "attiny1626",
      defines: ["__AVR_DEV_LIB_NAME__=tn1626"],
      includePaths: ["/pio/avr/include"]
    }]);
    mocks.runPreprocessor.mockResolvedValue([
      { name: "PORTB_OUTTGL", expansion: "_SFR_MEM8(0x0427)" }
    ]);

    const completions = await mocks.registeredProvider?.provideCompletionItems(
      document,
      position,
      activeToken
    );

    expect(mocks.runMetadata).toHaveBeenCalledWith({
      executablePath: "pio",
      projectDir: "/workspace"
    });
    expect(mocks.runPreprocessor).toHaveBeenCalledWith(expect.objectContaining({
      compilerPath: "/pio/avr-gcc",
      mcu: "attiny1626",
      defines: ["__AVR_DEV_LIB_NAME__=tn1626"],
      includePaths: ["/pio/avr/include"]
    }));
    expect(completions?.some(({ label }) => label === "PORTB_OUTTGL")).toBe(true);
  });

  it("retries metadata after a transient failure", async () => {
    mocks.trusted = true;
    mocks.settings = { usePlatformioMetadata: true };
    mocks.readFile.mockResolvedValue(Buffer.from("[env:test]\nplatform = atmelavr\n"));
    mocks.runMetadata
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce([{
        environmentName: "test",
        compilerPath: "/pio/avr-gcc",
        mcu: "atmega328p",
        defines: [],
        includePaths: []
      }]);
    mocks.runPreprocessor.mockResolvedValue([]);

    await mocks.registeredProvider?.provideCompletionItems(document, position, activeToken);
    await mocks.registeredProvider?.provideCompletionItems(document, position, activeToken);

    expect(mocks.runMetadata).toHaveBeenCalledTimes(2);
    expect(mocks.runPreprocessor).toHaveBeenCalledOnce();
  });
});
