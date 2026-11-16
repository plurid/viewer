export interface SharePoint {
  path: string;
  name: string;
  guests: boolean;
  readOnly: boolean;
}

/** Text records have no escaping: a line break in a name can forge a complete valid record. */
export function parseSharePoints(output: string): SharePoint[] | undefined {
  if (output.length > 1024 * 1024) return;
  const text = output.trim();
  if (text === 'No share point records.') return [];
  if (!text || !text.startsWith('{')) return;
  try {
    const records: unknown = JSON.parse(text);
    if (!records || typeof records !== 'object' || Array.isArray(records)) return;
    const points: SharePoint[] = [];
    for (const value of Object.values(records)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const record = value as Record<string, unknown>;
      if (typeof record.path !== 'string' || !record.path.startsWith('/') || record.path.includes('\0') ||
          typeof record.smb_name !== 'string' || !record.smb_name || record.smb_name.includes('\0') ||
          !['smb_shared', 'smb_guest_access', 'smb_read_only'].every((field) => record[field] === 0 || record[field] === 1)) return;
      if (record.smb_shared === 1) points.push({
        path: record.path, name: record.smb_name, guests: record.smb_guest_access === 1,
        readOnly: record.smb_read_only === 1,
      });
    }
    return points;
  } catch {
    return;
  }
}
