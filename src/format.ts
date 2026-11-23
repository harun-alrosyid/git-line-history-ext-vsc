export type DateFormatStyle = 'relative' | 'date' | 'datetime';

export function diffLines(previous: string, current: string): string {
  return `- ${previous}\n+ ${current}`;
}

export function commitUrl(remote: string | null, hash: string): string | null {
  if (!remote || !hash || /^0+$/.test(hash)) return null;
  let base = remote.trim().replace(/\/+$|\.git$/g, '');
  if (base.startsWith('git@')) {
    const separator = base.indexOf(':');
    if (separator < 0) return null;
    base = `https://${base.slice(4, separator)}/${base.slice(separator + 1)}`;
  } else if (base.startsWith('ssh://git@')) {
    base = `https://${base.slice('ssh://git@'.length).replace(/:\d+\//, '/')}`;
  }
  if (!/^https?:\/\//.test(base)) return null;
  try {
    const url = new URL(base);
    if (url.hostname.includes('gitlab')) {
      return `${base}/-/commit/${hash}`;
    }
    if (url.hostname.includes('bitbucket')) {
      const serverRepo = url.pathname.match(/^\/scm\/([^/]+)\/([^/]+)$/i);
      if (serverRepo) {
        return `${url.origin}/projects/${serverRepo[1].toUpperCase()}/repos/${serverRepo[2]}/commits/${hash}`;
      }
      return `${base}/commits/${hash}`;
    }
  } catch {}
  return `${base}/commit/${hash}`;
}

export function escapeMarkdown(value: unknown): string {
  return String(value).replace(/[\\`*_{}[\]()<>#+.!|~-]/g, '\\$&');
}

export function html(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  );
}

export function formatTimeAgo(date: Date | null, locale?: string, now: Date = new Date()): string {
  if (!date || isNaN(date.getTime())) return 'Unknown date';
  const diffInSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absDiff = Math.abs(diffInSeconds);

  if (absDiff < 45) return 'just now';

  try {
    const rtf = new Intl.RelativeTimeFormat(locale || undefined, { numeric: 'auto' });
    const minutes = Math.round(diffInSeconds / 60);
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');

    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');

    const days = Math.round(hours / 24);
    if (Math.abs(days) < 30) return rtf.format(days, 'day');

    const months = Math.round(days / 30.4375);
    if (Math.abs(months) < 12) return rtf.format(months, 'month');

    const years = Math.round(days / 365.25);
    return rtf.format(years, 'year');
  } catch {
    const absSeconds = Math.abs(diffInSeconds);
    if (absSeconds < 3600) return `${Math.round(absSeconds / 60)} minutes ago`;
    if (absSeconds < 86400) return `${Math.round(absSeconds / 3600)} hours ago`;
    if (absSeconds < 2592000) return `${Math.round(absSeconds / 86400)} days ago`;
    return `${Math.round(absSeconds / 31536000)} years ago`;
  }
}

export function formatDate(date: Date | null, style: DateFormatStyle = 'relative', locale?: string): string {
  if (!date || isNaN(date.getTime())) return 'Unknown date';
  if (style === 'date') return date.toLocaleDateString(locale || undefined);
  if (style === 'datetime') return date.toLocaleString(locale || undefined);
  return formatTimeAgo(date, locale);
}
