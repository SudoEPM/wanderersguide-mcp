import { wgFetch } from '../client.js';

interface ContentSource {
  id?: number;
  name?: string;
  url?: string;
  description?: string;
  group?: string;
  is_published?: boolean;
  user_id?: string | null;
  foundry_id?: string;
  contact_info?: string;
  require_key?: boolean;
  artwork_url?: string;
  [key: string]: unknown;
}

interface ContentUpdate {
  id?: number;
  type?: string;
  action?: string;
  status?: { state?: string; discord_user_name?: string };
  ref_id?: number;
  content_source_id?: number;
  created_at?: string;
  upvotes?: unknown[];
  downvotes?: unknown[];
  [key: string]: unknown;
}

function formatContentSource(s: ContentSource): string {
  const lines: string[] = [];
  if (s.name) lines.push(`**${s.name}**${s.id !== undefined ? ` (ID: ${s.id})` : ''}`);
  const tags: string[] = [];
  if (s.group) tags.push(s.group);
  if (s.user_id) tags.push('homebrew');
  if (s.is_published) tags.push('published');
  if (s.require_key) tags.push('requires key');
  if (tags.length) lines.push(tags.join(' · '));
  if (s.description) lines.push(s.description);
  if (s.url) lines.push(`URL: ${s.url}`);
  if (s.foundry_id) lines.push(`Foundry ID: ${s.foundry_id}`);
  if (s.contact_info) lines.push(`Contact: ${s.contact_info}`);
  return lines.join('\n');
}

function formatContentUpdate(u: ContentUpdate): string {
  const lines: string[] = [];
  const header = [
    u.action,
    u.type,
    u.id !== undefined ? `(ID: ${u.id})` : null,
  ].filter(Boolean).join(' ');
  if (header) lines.push(`**${header}**`);
  if (u.status?.state) lines.push(`State: ${u.status.state}`);
  if (u.status?.discord_user_name) lines.push(`Submitted by: ${u.status.discord_user_name}`);
  const votes = (u.upvotes?.length ?? 0) - (u.downvotes?.length ?? 0);
  if ((u.upvotes?.length ?? 0) + (u.downvotes?.length ?? 0) > 0) lines.push(`Votes: ${votes >= 0 ? '+' : ''}${votes}`);
  if (u.content_source_id !== undefined) lines.push(`Content Source ID: ${u.content_source_id}`);
  if (u.created_at) lines.push(`Created: ${u.created_at}`);
  return lines.join('\n');
}

export async function findContentSource(args: {
  id?: number | number[];
  foundry_id?: string;
  group?: string;
  homebrew?: boolean;
  published?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = Array.isArray(args.id) ? args.id : [args.id];
  if (args.foundry_id) body.foundry_id = args.foundry_id;
  if (args.group) body.group = args.group;
  // API uses is_published for the published filter
  if (args.published !== undefined) body.published = args.published;
  // homebrew is indicated by user_id being set; pass as-is to API
  if (args.homebrew !== undefined) body.homebrew = args.homebrew;

  const results = await wgFetch<ContentSource[]>('find-content-source', body);

  if (!results || results.length === 0) {
    return `No content sources found matching the given criteria.`;
  }

  return results.map(formatContentSource).join('\n\n---\n\n');
}

export async function findContentUpdate(args: {
  id?: number;
  user_id?: string;
  state?: 'PENDING' | 'APPROVED' | 'REJECTED';
  created?: { from?: string; to?: string };
}): Promise<string> {
  const body: Record<string, unknown> = {};
  if (args.id !== undefined) body.id = args.id;
  if (args.user_id) body.user_id = args.user_id;
  if (args.state) body.state = args.state;
  if (args.created) body.created = args.created;

  const results = await wgFetch<ContentUpdate[]>('find-content-update', body);

  if (!results || results.length === 0) {
    return `No content updates found matching the given criteria.`;
  }

  return results.map(formatContentUpdate).join('\n\n---\n\n');
}
