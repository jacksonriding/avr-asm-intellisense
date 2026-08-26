import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registeredProvider: undefined as undefined | {
    provideCompletionItems: (...args: unknown[]) => Promise<Array<{ label: string }>>;
  },
  registeredCommands: new Map<string, (...args: unknown[]) => unknown>(),
  settings: {} as Record<string, unknown>,
  trusted: false,
  readFile: vi.fn(),
  runMetadata: vi.fn(),
  runPreprocessor: vi.fn(),
  outputAppendLine: vi.fn(),
  outputShow: vi.fn(),
  showInformationMessage: vi.fn()
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
    commands: {
      registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
        mocks.registeredCommands.set(name, callback);
        return disposable();
      }
    },
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
      activeTextEditor: {
        document: {
          uri: {
            scheme: "file",
            fsPath: "/workspace/src/main.S",
            toString: () => "file:///workspace/src/main.S"
          },
          languageId: "avr-asm",
          version: 1,
          getText: () => "#include <avr/io.h>\nldi r16, 0"
        }
      },
      createOutputChannel: () => ({
        appendLine: mocks.outputAppendLine,
        show: mocks.outputShow,
        dispose: vi.fn()
      }),
      showInformationMessage: mocks.showInformationMessage
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

const documentForMock = {
  uri: {
    scheme: "file",
    fsPath: "/workspace/src/main.S",
    toString: () => "file:///workspace/src/main.S"
  },
  version: 1,
  getText: () => "#include <avr/io.h>\nldi r16, 0"
};

import { activate } from "../src/extension";

const document = documentForMock;
const position = {};
const activeToken = { isCancellationRequested: false };

describe("extension integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registeredProvider = undefined;
    mocks.registeredCommands.clear();
    mocks.settings = {};
    mocks.trusted = false;
    activate({ subscriptions: [] } as never);
  });

  it("registers a command that reports the active per-file compilation context", async () => {
    mocks.trusted = true;
    mocks.readFile.mockImplementation(async (uri: { fsPath: string }) => {
      if (uri.fsPath.endsWith("compile_commands.json")) {
        return Buffer.from(JSON.stringify([{
          directory: "/workspace",
          file: "src/main.S",
          arguments: ["/tools/avr-gcc", "-mmcu=atmega328p", "-DPROJECT=1", "-c", "src/main.S"]
        }]));
      }
      throw new Error("not found");
    });

    await mocks.registeredCommands.get("avrAsmIntellisense.showActiveContext")?.();

    expect(mocks.outputAppendLine).toHaveBeenCalledWith(expect.stringContaining(
      "Source: compile_commands.json"
    ));
    expect(mocks.outputAppendLine).toHaveBeenCalledWith(expect.stringContaining("MCU: atmega328p"));
    expect(mocks.outputShow).toHaveBeenCalled();
    expect(mocks.runMetadata).not.toHaveBeenCalled();
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
