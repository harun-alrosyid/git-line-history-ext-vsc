import * as vscode from 'vscode';

export function createInlineBlameDecoration(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({ after: {
    color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic', margin: '0 0 0 2em'
  }});
}
