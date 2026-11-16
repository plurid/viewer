export interface SharePoint {
  path: string;
  name: string;
  guests: boolean;
  readOnly: boolean;
}

/** An incomplete record must not turn an unknown guest policy into a reassuring badge. */
export function parseSharePoints(output: string): SharePoint[] | undefined {
  if (output.length > 1024 * 1024 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(output)) return;
  const text = output.trim();
  if (!text || text === 'No share point records.') return [];
  const lines = text.split('\n');
  if (lines.shift() !== 'List of Share Points') return;
  const shares: SharePoint[] = [];
  let record: Map<string, string> | undefined;
  let smb: Map<string, string> | undefined;
  let inside = false;
  const finish = (): boolean => {
    if (!record || !smb || inside) return false;
    const name = smb.get('name');
    const path = record.get('path');
    if (
      !record.get('name') ||
      !name ||
      !path?.startsWith('/') ||
      !['shared', 'guest access', 'read-only'].every((key) => /^[01]$/.test(smb!.get(key) ?? ''))
    )
      return false;
    if (smb.get('shared') === '1')
      shares.push({
        path,
        name,
        guests: smb.get('guest access') === '1',
        readOnly: smb.get('read-only') === '1',
      });
    return true;
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.trim() === '}') {
      if (!inside) return;
      inside = false;
      continue;
    }
    const match = /^([ \t]*)([^:]+):[ \t]*(.*)$/.exec(line);
    if (!match) return;
    const [, indent, rawKey, value] = match;
    const key = rawKey!.trim();
    if (!indent && key === 'name') {
      if (record && !finish()) return;
      record = new Map([['name', value!]]);
      smb = undefined;
      continue;
    }
    if (!record) return;
    if (key === 'smb') {
      if (inside || smb || value !== '{') return;
      inside = true;
      smb = new Map();
      continue;
    }
    const known = inside ? ['name', 'shared', 'guest access', 'read-only'] : ['path'];
    if (!known.includes(key)) continue;
    if ((inside && !indent) || (!inside && indent)) return;
    const fields = inside ? smb! : record;
    if (fields.has(key)) return;
    fields.set(key, value!);
  }
  if (!finish()) return;
  return shares;
}
