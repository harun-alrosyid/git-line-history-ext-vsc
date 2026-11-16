import * as vscode from 'vscode';
import { lineCommit, parseBlame } from './git';
import { commitUrl, diffLines, escapeMarkdown, html } from './format';
import { createInlineBlameDecoration } from './styles';

function copyLink(hash: string): string { return `[$(copy)](command:gitLineHistory.copyCommit?${encodeURIComponent(JSON.stringify([hash]))} "Copy commit hash")`; }

export function activate(context: vscode.ExtensionContext): void {
  const inlineBlame = createInlineBlameDecoration();
  let updateId = 0;
  let summaryRange: { uri: string; line: number; start: number } | undefined;
  context.subscriptions.push(vscode.commands.registerCommand('gitLineHistory.reloadExtension', () => vscode.commands.executeCommand('workbench.action.restartExtensionHost')));
  context.subscriptions.push(vscode.commands.registerCommand('gitLineHistory.copyCommit', async (hash: string) => {
    await vscode.env.clipboard.writeText(hash);
    vscode.window.showInformationMessage('Commit hash copied');
  }), inlineBlame);
  context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: 'file' }, {
    async provideHover(document, position) {
      if (!summaryRange || summaryRange.line !== position.line || summaryRange.uri !== document.uri.toString() || position.character < summaryRange.start) return;
      try {
        const commit = await lineCommit(document.uri, position.line);
        if (!commit) return;
        const locale = vscode.workspace.getConfiguration('gitLineHistory').get<string>('dateLocale') || undefined;
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = { enabledCommands: ['gitLineHistory.copyCommit'] };
        markdown.supportThemeIcons = true;
        markdown.supportHtml = true;
        const currentUrl = commitUrl(commit.origin, commit.hash);
        const currentHash = currentUrl ? `[${commit.hash.slice(0, 8)}](${currentUrl})` : `\`${commit.hash.slice(0, 8)}\``;
        markdown.appendMarkdown(`<span style="color:var(--vscode-gitDecoration-addedResourceForeground)"><strong>${html(commit.author)}</strong></span>, <strong>${escapeMarkdown(commit.date?.toLocaleString(locale) || 'Unknown date')}</strong>  \n`);
        markdown.appendMarkdown(`<span style="color:var(--vscode-textLink-foreground);"><strong>${currentHash} ${copyLink(commit.hash)} — ${html(commit.summary)}</strong></span>\n\n`);
        if (commit.parent) {
          const parentUrl = commitUrl(commit.origin, commit.parent.hash);
          const parentHash = parentUrl ? `[${commit.parent.hash.slice(0, 8)}](${parentUrl})` : `\`${commit.parent.hash.slice(0, 8)}\``;
          markdown.appendMarkdown(`<span style="color:var(--vscode-gitDecoration-addedResourceForeground)">${html(commit.parent.author)}</span>, ${escapeMarkdown(commit.parent.date?.toLocaleString(locale) || 'Unknown date')}  \n`);
          markdown.appendMarkdown(`<span style="color:var(--vscode-textLink-foreground)">${parentHash} ${copyLink(commit.parent.hash)} — ${html(commit.parent.summary)}</span>\n\n**Line comparison**  \n`);
          markdown.appendCodeblock(diffLines(commit.parent.line, document.lineAt(position.line).text), 'diff');
        }
        return new vscode.Hover(markdown);
      } catch { return; }
    }
  }));
  const updateInlineBlame = async (editor: vscode.TextEditor): Promise<void> => {
    const currentId = ++updateId;
    editor.setDecorations(inlineBlame, []);
    summaryRange = undefined;
    try {
      const line = editor.selection.active.line;
      const commit = await lineCommit(editor.document.uri, line);
      if (!commit || currentId !== updateId || editor !== vscode.window.activeTextEditor) return;
      const locale = vscode.workspace.getConfiguration('gitLineHistory').get<string>('dateLocale') || undefined;
      const summary = commit.summary.length > 72 ? `${commit.summary.slice(0, 69)}...` : commit.summary;
      const lineLength = editor.document.lineAt(line).text.length;
      summaryRange = { uri: editor.document.uri.toString(), line, start: lineLength };
      editor.setDecorations(inlineBlame, [{ range: new vscode.Range(line, lineLength, line, lineLength), renderOptions: { after: { contentText: `${commit.author} · ${commit.date?.toLocaleDateString(locale) || 'Unknown date'} · ${summary}` } } }]);
    } catch { }
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => editor && updateInlineBlame(editor)), vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => updateInlineBlame(textEditor)));
  if (vscode.window.activeTextEditor) updateInlineBlame(vscode.window.activeTextEditor);
}

export { commitUrl, diffLines } from './format';
export { parseBlame };
