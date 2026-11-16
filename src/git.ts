import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type * as vscode from 'vscode';

const exec = promisify(execFile);

export type ParentCommit = { hash: string; author: string; date: Date | null; summary: string; line: string };
export type LineCommit = { hash: string; origin: string | null; author: string; date: Date | null; summary: string; parent?: ParentCommit };

export function parseBlame(output: string): Record<string, string> {
  return Object.fromEntries(output.split('\n').flatMap((line) => {
    const separator = line.indexOf(' ');
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
  }));
}

function getDate(fields: Record<string, string>): Date | null {
  const timestamp = Number(fields['author-time']);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000) : null;
}

export async function lineCommit(uri: vscode.Uri, line: number): Promise<LineCommit | null> {
  const vscode = require('vscode') as typeof import('vscode');
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return null;
  const root = (await exec('git', ['rev-parse', '--show-toplevel'], { cwd: folder.uri.fsPath })).stdout.trim();
  const relative = path.relative(root, uri.fsPath);
  let origin: string | null = null;
  try { origin = (await exec('git', ['remote', 'get-url', 'origin'], { cwd: root })).stdout.trim(); } catch {}
  const output = (await exec('git', ['blame', '--line-porcelain', '-L', `${line + 1},${line + 1}`, '--', relative], { cwd: root })).stdout;
  const fields = parseBlame(output);
  if (!fields.author || !fields.summary) return null;
  const hash = output.split('\n', 1)[0].split(' ')[0];
  const parents = (await exec('git', ['show', '-s', '--format=%P', hash], { cwd: root })).stdout.trim().split(/\s+/);
  const parent = parents[0];
  if (!parent) return { hash, origin, author: fields.author, summary: fields.summary, date: getDate(fields) };
  let parentLine = '(file did not exist)';
  try {
    const parentLines = (await exec('git', ['show', `${parent}:${relative}`], { cwd: root })).stdout.split(/\r?\n/);
    parentLine = parentLines[line] ?? '(line did not exist)';
  } catch {}
  const parentFields = (await exec('git', ['show', '-s', '--format=%an%x00%aI%x00%s', parent], { cwd: root })).stdout.split('\0');
  return { hash, origin, author: fields.author, date: getDate(fields), summary: fields.summary, parent: {
    hash: parent, author: parentFields[0], date: parentFields[1] ? new Date(parentFields[1]) : null,
    summary: parentFields[2], line: parentLine
  }};
}
