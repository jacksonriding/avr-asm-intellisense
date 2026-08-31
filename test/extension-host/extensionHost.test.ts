import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import * as vscode from "vscode";

import { pathsEqual } from "./testPath";

function completionLabel(item: vscode.CompletionItem): string {
  return typeof item.label === "string" ? item.label : item.label.label;
}

function hoverText(hover: vscode.Hover): string {
  return hover.contents.map((content) => {
    if (typeof content === "string") {
      return content;
    }
    if (content instanceof vscode.MarkdownString) {
      return content.value;
    }
    return content.value;
  }).join("\n");
}

async function openFixture(
  workspaceFolder: vscode.WorkspaceFolder,
  fileName: string
): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(workspaceFolder.uri, "src", fileName)
  );
  await vscode.window.showTextDocument(document);
  return document;
}

async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail(message);
    }
    await new Promise((settle) => setTimeout(settle, 25));
  }
}

async function assertForbiddenToolNotLaunched(): Promise<void> {
  const markerPath = process.env.AVR_ASM_FORBIDDEN_TOOL_MARKER;
  if (markerPath === undefined) {
    return;
  }

  try {
    await access(markerPath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  assert.fail("Restricted Mode smoke must not launch project discovery or compiler tools");
}

export async function runExtensionHostSmoke(): Promise<void> {
  const expectedWorkspaceTrust = process.env.AVR_ASM_EXPECTED_WORKSPACE_TRUST;
  if (expectedWorkspaceTrust !== undefined) {
    assert.ok(
      expectedWorkspaceTrust === "trusted" || expectedWorkspaceTrust === "restricted",
      "AVR_ASM_EXPECTED_WORKSPACE_TRUST must be trusted or restricted"
    );
    assert.equal(
      vscode.workspace.isTrusted,
      expectedWorkspaceTrust === "trusted",
      `workspace should run in ${expectedWorkspaceTrust} mode`
    );
  }

  const extension = vscode.extensions.getExtension("local-development.avr-asm-intellisense");
  assert.ok(extension, "AVR Assembly IntelliSense should be available in the Extension Host");

  const sourceCheckout = resolve(__dirname, "../..");
  const targetIsSourceCheckout = pathsEqual(extension.extensionPath, sourceCheckout);
  if (process.env.AVR_ASM_EXTENSION_MODE === "production") {
    assert.equal(
      targetIsSourceCheckout,
      false,
      "packaged smoke must not load the source checkout as the target extension"
    );
  } else {
    assert.equal(
      targetIsSourceCheckout,
      true,
      "source smoke should load the repository as its development extension"
    );
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(workspaceFolder, "fixture workspace should be open");
  const document = await openFixture(workspaceFolder, "main.S");
  assert.equal(document.languageId, "avr-asm", ".S should map to AVR assembly");

  await waitUntil(
    () => extension.isActive,
    "opening an AVR document should activate the extension through its manifest"
  );

  const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    document.uri,
    new vscode.Position(0, 0)
  );
  const completionLabels = new Set(completions.items.map(completionLabel));
  for (const expected of ["LDI", "r16", ".section"]) {
    assert.ok(
      completionLabels.has(expected),
      `${expected} should be available without a configured toolchain`
    );
  }

  for (const fileName of ["lower.s", "legacy.asm"]) {
    const associatedDocument = await openFixture(workspaceFolder, fileName);
    assert.equal(associatedDocument.languageId, "avr-asm", `${fileName} should map to AVR assembly`);
  }
  await vscode.window.showTextDocument(document);

  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    document.uri,
    new vscode.Position(0, 1)
  );
  assert.ok(
    hovers.some((hover) => hoverText(hover).includes("### `LDI`")),
    "instruction hover should be available in the real Extension Host"
  );

  const signature = await vscode.commands.executeCommand<vscode.SignatureHelp>(
    "vscode.executeSignatureHelpProvider",
    document.uri,
    new vscode.Position(0, 9),
    ","
  );
  assert.ok(signature, "instruction signature help should be available");
  assert.ok(
    signature.signatures.some((item) => item.label === "LDI Rd, K"),
    "LDI signature should describe both operands"
  );
  assert.equal(signature.activeParameter, 1, "the immediate operand should be active after the comma");

  const commands = await vscode.commands.getCommands(true);
  assert.ok(
    commands.includes("avrAsmIntellisense.showActiveContext"),
    "the active-context command should be registered"
  );
  await vscode.commands.executeCommand("avrAsmIntellisense.showActiveContext");
  await assertForbiddenToolNotLaunched();
}
