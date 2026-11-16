export function diffLines(previous: string, current: string): string { return `- ${previous}\n+ ${current}`; }

export function commitUrl(remote: string | null, hash: string): string | null {
  if (!remote) return null;
  let base = remote.trim().replace(/\/$|\.git$/g, '');
  if (base.startsWith('git@')) {
    const separator = base.indexOf(':');
    if (separator < 0) return null;
    base = `https://${base.slice(4, separator)}/${base.slice(separator + 1)}`;
  } else if (base.startsWith('ssh://git@')) base = `https://${base.slice('ssh://git@'.length)}`;
  if (!/^https?:\/\//.test(base)) return null;
  return `${base}/commit/${hash}`;
}

export function escapeMarkdown(value: unknown): string { return String(value).replace(/[\\`*_{}[\]()<>#+.!|~-]/g, '\\$&'); }
export function html(value: unknown): string { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
