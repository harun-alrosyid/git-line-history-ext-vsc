import * as vscode from 'vscode';
import * as path from 'node:path';
import { clearGitCache, getRemoteOrigin, getRepoRoot, lineCommit, lineHistory, parseBlame } from './git';
import { commitUrl, DateFormatStyle, diffLines, escapeMarkdown, formatDate, html } from './format';
import { createInlineBlameDecoration } from './styles';

function copyLink(hash: string): string {
  return `[$(copy)](command:gitLineHistory.copyCommit?${encodeURIComponent(JSON.stringify([hash]))} "Copy commit hash")`;
}

export function activate(context: vscode.ExtensionContext): void {
  const inlineBlame = createInlineBlameDecoration();
  let updateId = 0;
  let summaryRange: { uri: string; line: number; start: number } | undefined;
  let debounceTimer: NodeJS.Timeout | undefined;
  let lastUri: string | undefined;
  let lastLine: number | undefined;
  let lastVersion: number | undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand('gitLineHistory.reloadExtension', () => {
      clearGitCache();
      vscode.commands.executeCommand('workbench.action.restartExtensionHost');
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand('gitLineHistory.moreHistory', async (filePath: string, line: number, version: number) => {
    let offset = 0;
    for (; ;) {
      const page = await lineHistory(filePath, line, version, offset);
      if (!page) { await vscode.window.showInformationMessage('Line history is unavailable for this file or line.'); return; }
      type HistoryPick = vscode.QuickPickItem & { commit?: (typeof page.commits)[number] };
      const items: HistoryPick[] = page.commits.map((commit, i) => ({ label: `${offset + i + 1}. ${commit.hash.slice(0, 8)} · ${commit.author}`, description: `${commit.date?.toLocaleString() ?? 'Unknown date'} · ${commit.summary}`, commit }));
      const loadMore: HistoryPick | undefined = !page.complete ? { label: 'Show next 10 $(arrow-right)' } : undefined;
      const previous: HistoryPick | undefined = offset > 0 ? { label: '$(arrow-left) Show previous 10' } : undefined;
      const selected = await vscode.window.showQuickPick<HistoryPick>([...(previous ? [previous] : []), ...items, ...(loadMore ? [loadMore] : [])], { placeHolder: `Line history · ${offset + 1}–${offset + page.commits.length}` });
      if (!selected) return;
      if (selected === previous) { offset = Math.max(0, offset - 10); continue; }
      if (selected === loadMore) { offset += page.commits.length; continue; }
      if (selected.commit) {
        const actions = ['Copy Commit Hash', 'Open Commit in Browser'];
        const action = await vscode.window.showQuickPick(actions, { placeHolder: `${selected.commit.hash.slice(0, 8)} · ${selected.commit.summary}` });
        if (action === actions[0]) {
          await vscode.env.clipboard.writeText(selected.commit.hash);
          vscode.window.showInformationMessage('Commit hash copied');
        } else if (action === actions[1]) {
          const root = await getRepoRoot(path.dirname(filePath));
          const remote = root ? await getRemoteOrigin(root) : null;
          const url = commitUrl(remote, selected.commit.hash);
          if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
          else vscode.window.showInformationMessage('No supported Git remote URL is available.');
        }
      }
      return;
    }
  }));

  context.subscriptions.push(
    vscode.commands.registerCommand('gitLineHistory.copyCommit', async (hash: string) => {
      if (!hash || /^0+$/.test(hash)) return;
      await vscode.env.clipboard.writeText(hash);
      vscode.window.showInformationMessage('Commit hash copied');
    }),
    inlineBlame
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, {
      async provideHover(document, position) {
        if (!summaryRange || summaryRange.line !== position.line || summaryRange.uri !== document.uri.toString() || position.character < summaryRange.start) {
          return;
        }
        try {
          const contents = document.isDirty ? document.getText() : undefined;
          const commit = await lineCommit(document.uri.fsPath, position.line, { includeParent: true, contents });
          if (!commit) return;

          const config = vscode.workspace.getConfiguration('gitLineHistory');
          const showUncommitted = config.get<boolean>('showUncommitted', false);
          if (commit.isUncommitted && !showUncommitted) return;

          const locale = config.get<string>('dateLocale') || undefined;
          const markdown = new vscode.MarkdownString();
          markdown.isTrusted = { enabledCommands: ['gitLineHistory.copyCommit', 'gitLineHistory.moreHistory'] };
          markdown.supportThemeIcons = true;
          markdown.supportHtml = true;

          if (commit.isUncommitted) {
            markdown.appendMarkdown(`<span style="color:var(--vscode-gitDecoration-addedResourceForeground)"><strong>${html(commit.author)}</strong></span>, <em>${html(commit.summary)}</em>  \n`);
            markdown.appendMarkdown(`<span style="color:var(--vscode-descriptionForeground)">Local changes not yet committed</span>\n\n`);
            if (commit.parent) {
              const parentUrl = commitUrl(commit.origin, commit.parent.hash);
              const parentHash = parentUrl ? `[${commit.parent.hash.slice(0, 8)}](${parentUrl})` : `\`${commit.parent.hash.slice(0, 8)}\``;
              const parentFullDate = formatDate(commit.parent.date, 'datetime', locale);
              const parentRelativeDate = formatDate(commit.parent.date, 'relative', locale);
              const parentDateDisplay = (commit.parent.date && parentRelativeDate !== parentFullDate) ? `${parentRelativeDate} (${parentFullDate})` : parentFullDate;
              markdown.appendMarkdown(`**Previous commit**  \n`);
              markdown.appendMarkdown(`<span style="color:var(--vscode-gitDecoration-addedResourceForeground)">${html(commit.parent.author)}</span>, ${escapeMarkdown(parentDateDisplay)}  \n`);
              markdown.appendMarkdown(`<span style="color:var(--vscode-textLink-foreground)">${parentHash} ${copyLink(commit.parent.hash)} — ${html(commit.parent.summary)}</span>\n\n**Line comparison**  \n`);
              markdown.appendCodeblock(diffLines(commit.parent.line, document.lineAt(position.line).text), 'diff');
            }
          } else {
            const currentUrl = commitUrl(commit.origin, commit.hash);
            const currentHash = currentUrl ? `[${commit.hash.slice(0, 8)}](${currentUrl})` : `\`${commit.hash.slice(0, 8)}\``;
            const fullDate = formatDate(commit.date, 'datetime', locale);
            const relativeDate = formatDate(commit.date, 'relative', locale);
            const dateDisplay = (commit.date && relativeDate !== fullDate) ? `${relativeDate} (${fullDate})` : fullDate;

            markdown.appendMarkdown(`<span style="color:var(--vscode-gitDecoration-addedResourceForeground)"><strong>${html(commit.author)}</strong></span>, <strong>${escapeMarkdown(dateDisplay)}</strong>  \n`);
            markdown.appendMarkdown(`<span style="color:var(--vscode-textLink-foreground);"><strong>${currentHash} ${copyLink(commit.hash)} — ${html(commit.summary)}</strong></span>\n\n`);
            if (commit.parent) {
              const parentUrl = commitUrl(commit.origin, commit.parent.hash);
              const parentHash = parentUrl ? `[${commit.parent.hash.slice(0, 8)}](${parentUrl})` : `\`${commit.parent.hash.slice(0, 8)}\``;
              const parentFullDate = formatDate(commit.parent.date, 'datetime', locale);
              const parentRelativeDate = formatDate(commit.parent.date, 'relative', locale);
              const parentDateDisplay = (commit.parent.date && parentRelativeDate !== parentFullDate) ? `${parentRelativeDate} (${parentFullDate})` : parentFullDate;

              markdown.appendMarkdown(`<span style="color:var(--vscode-gitDecoration-addedResourceForeground)">${html(commit.parent.author)}</span>, ${escapeMarkdown(parentDateDisplay)}  \n`);
              markdown.appendMarkdown(`<span style="color:var(--vscode-textLink-foreground)">${parentHash} ${copyLink(commit.parent.hash)} — ${html(commit.parent.summary)}</span>\n\n**Line comparison**  \n`);
              markdown.appendCodeblock(diffLines(commit.parent.line, document.lineAt(position.line).text), 'diff');
            }
          }
          const historyArgs = encodeURIComponent(JSON.stringify([document.uri.fsPath, position.line, document.version]));
          markdown.appendMarkdown(`\n[More History...](command:gitLineHistory.moreHistory?${historyArgs})`);
          return new vscode.Hover(markdown);
        } catch {
          return;
        }
      }
    })
  );

  const updateInlineBlame = (editor: vscode.TextEditor, immediate = false): void => {
    const currentLine = editor.selection.active.line;
    const currentUri = editor.document.uri.toString();
    const currentVersion = editor.document.version;

    if (!immediate && currentUri === lastUri && currentLine === lastLine && currentVersion === lastVersion) {
      return;
    }

    lastUri = currentUri;
    lastLine = currentLine;
    lastVersion = currentVersion;
    const currentId = ++updateId;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    const run = async () => {
      try {
        const contents = editor.document.isDirty ? editor.document.getText() : undefined;
        const commit = await lineCommit(editor.document.uri.fsPath, currentLine, { includeParent: false, contents });
        const config = vscode.workspace.getConfiguration('gitLineHistory');
        const showUncommitted = config.get<boolean>('showUncommitted', false);

        if (!commit || (commit.isUncommitted && !showUncommitted) || currentId !== updateId || editor !== vscode.window.activeTextEditor) {
          if (currentId === updateId) {
            editor.setDecorations(inlineBlame, []);
            summaryRange = undefined;
          }
          return;
        }

        const locale = config.get<string>('dateLocale') || undefined;
        const dateFormat = config.get<DateFormatStyle>('dateFormat', 'relative');
        const summary = commit.summary.length > 72 ? `${commit.summary.slice(0, 69)}...` : commit.summary;
        const lineLength = editor.document.lineAt(currentLine).text.length;
        summaryRange = { uri: currentUri, line: currentLine, start: lineLength };

        const dateText = commit.isUncommitted ? '' : ` · ${formatDate(commit.date, dateFormat, locale)}`;
        editor.setDecorations(inlineBlame, [{
          range: new vscode.Range(currentLine, lineLength, currentLine, lineLength),
          renderOptions: { after: { contentText: `${commit.author}${dateText} · ${summary}` } }
        }]);
      } catch {
        editor.setDecorations(inlineBlame, []);
        summaryRange = undefined;
      }
    };

    if (immediate) {
      run();
    } else {
      debounceTimer = setTimeout(run, 120);
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => editor && updateInlineBlame(editor, true)),
    vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => updateInlineBlame(textEditor)),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.uri.toString() === document.uri.toString()) {
        updateInlineBlame(activeEditor);
      }
    })
  );

  if (vscode.window.activeTextEditor) {
    updateInlineBlame(vscode.window.activeTextEditor, true);
  }
}

export { commitUrl, diffLines, formatDate, formatTimeAgo } from './format';
export { parseBlame, clearGitCache };
