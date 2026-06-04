import { wgFetch } from '../client.js';

interface Language {
  id?: number;
  name?: string;
  description?: string;
  speakers?: string;
  script?: string;
  [key: string]: unknown;
}

function formatLanguage(l: Language): string {
  const lines: string[] = [];
  if (l.name) lines.push(`**${l.name}**${l.id !== undefined ? ` (ID: ${l.id})` : ''}`);
  if (l.speakers) lines.push(`Speakers: ${l.speakers}`);
  if (l.script) lines.push(`Script: ${l.script}`);
  if (l.description) lines.push(`\n${l.description}`);
  return lines.join('\n');
}

export async function findLanguage(args: {
  name?: string;
  id?: number | number[];
  content_sources?: number[];
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.name) body.name = args.name;
  if (args.id !== undefined) body.id = args.id;
  if (args.content_sources?.length) body.content_sources = args.content_sources;

  const results = await wgFetch<Language[]>('find-language', body);

  if (!results || results.length === 0) {
    const term = args.name ?? (args.id !== undefined ? String(args.id) : null) ?? 'given criteria';
    return `No languages found matching "${term}".`;
  }

  return results.map(formatLanguage).join('\n\n---\n\n');
}
