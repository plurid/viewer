export const roleWords = new Set([
  'site',
  'server',
  'web',
  'app',
  'api',
  'meta',
  'www',
  'frontend',
  'backend',
  'landing',
  'com',
  'org',
  'next',
  'generator',
  'db',
  'data',
  'scraper',
  'agent',
  'extension',
  'cli',
  'lib',
  'sdk',
  'assets',
  'mobile',
  'admin',
  'dashboard',
  'service',
  'worker',
  'bot',
  'src',
  'core',
  'client',
]);

export function slug(segment: string): string {
  return (
    segment
      .trim()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '') || 'x'
  );
}

export function projectNameParts(name: string): string[] {
  return name
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function keyFor(name: string): string {
  return projectNameParts(name).map(slug).join('/') || 'x';
}

export function stubName(name: string): string {
  const parts = projectNameParts(name);
  const leaf = parts.at(-1) ?? 'Workspace';
  return parts.length > 1 && roleWords.has(slug(leaf)) ? `${parts.at(-2)} ${leaf}` : leaf;
}

export function uniqueKey(key: string, taken: ReadonlySet<string>): string {
  let candidate = key;
  let suffix = 2;
  while (taken.has(candidate)) candidate = `${key}-${suffix++}`;
  return candidate;
}
