import * as vscode from "vscode";

import {
  buildInstructionHover,
  getInstructionSignatureHelp
} from "../core/instructionLanguage";

function instructionHoverProvider(): vscode.HoverProvider {
  return {
    provideHover(document, position): vscode.Hover | undefined {
      const hover = buildInstructionHover(document.lineAt(position.line).text, position.character);
      if (hover === undefined) {
        return undefined;
      }
      const markdown = new vscode.MarkdownString(hover.markdown);
      markdown.isTrusted = false;
      markdown.supportHtml = false;
      return new vscode.Hover(
        markdown,
        new vscode.Range(position.line, hover.start, position.line, hover.end)
      );
    }
  };
}

function instructionSignatureProvider(): vscode.SignatureHelpProvider {
  return {
    provideSignatureHelp(document, position): vscode.SignatureHelp | undefined {
      const help = getInstructionSignatureHelp(
        document.lineAt(position.line).text,
        position.character
      );
      if (help === undefined) {
        return undefined;
      }
      const result = new vscode.SignatureHelp();
      result.signatures = help.signatures.map((signature) => {
        const item = new vscode.SignatureInformation(signature.label, signature.documentation);
        item.parameters = signature.parameters.map(
          (parameter) => new vscode.ParameterInformation(
            parameter.label,
            parameter.documentation
          )
        );
        return item;
      });
      result.activeSignature = help.activeSignature;
      result.activeParameter = help.activeParameter;
      return result;
    }
  };
}

export function registerInstructionProviders(): readonly vscode.Disposable[] {
  return Object.freeze([
    vscode.languages.registerHoverProvider("avr-asm", instructionHoverProvider()),
    vscode.languages.registerSignatureHelpProvider(
      "avr-asm",
      instructionSignatureProvider(),
      " ",
      ","
    )
  ]);
}
