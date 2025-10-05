import * as vscode from "vscode";
import { formatJspDocument } from "./formatter";

export function activate(context: vscode.ExtensionContext) {
  const provider = vscode.languages.registerDocumentFormattingEditProvider(
    { language: "jsp" },
    {
      async provideDocumentFormattingEdits(document) {
        const text = document.getText();
        const settings = vscode.workspace.getConfiguration();

        const tabWidth = settings.get<number>("jspFormatter.tabWidth", 2);
        const useTabs = settings.get<boolean>("jspFormatter.useTabs", false);
        const javaFormat = settings.get<string>("jspFormatter.javaFormat", "auto") as
          | "auto"
          | "indent-only"
          | "off";
        const blockIndent = settings.get<number>("jspFormatter.blockIndent", 2); // ← nuevo

        const formatted = await formatJspDocument(text, {
          tabWidth,
          useTabs,
          javaFormat,
          blockIndent
        });

        if (formatted === text) return []; // no-op

        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(text.length)
        );
        return [vscode.TextEdit.replace(fullRange, formatted)];
      }
    }
  );

  context.subscriptions.push(provider);
}

export function deactivate() {}
