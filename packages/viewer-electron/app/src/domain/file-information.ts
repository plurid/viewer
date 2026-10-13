/** Native metadata belongs to the file, never to Viewer's configuration. */
export interface FileTag {
  name: string;
  /** Finder label numbers: none, gray, green, purple, blue, yellow, red, orange. */
  color: number;
}
export interface FileInformation {
  path: string;
  identity: string;
  revision: string;
  tags: FileTag[];
  comment: string;
  locked: boolean;
  mode: number;
  owner: string;
  group: string;
  allocatedSize: number;
  package: boolean;
  readOnly: boolean;
  canEdit: boolean;
  metadataSupported: boolean;
  metadataReadable: boolean;
  systemTagNames: string[];
  alias: boolean;
}
export interface FileInformationPatch {
  tags?: FileTag[];
  comment?: string;
  locked?: boolean;
  mode?: number;
}
export const tagColors = [
  'None',
  'Gray',
  'Green',
  'Purple',
  'Blue',
  'Yellow',
  'Red',
  'Orange',
] as const;
export function informationChanges(
  before: FileInformation,
  next: FileInformationPatch,
): FileInformationPatch {
  const changes: FileInformationPatch = {};
  if (next.tags && JSON.stringify(before.tags) !== JSON.stringify(next.tags))
    changes.tags = next.tags;
  if (next.comment !== undefined && next.comment !== before.comment) changes.comment = next.comment;
  if (next.locked !== undefined && next.locked !== before.locked) changes.locked = next.locked;
  if (next.mode !== undefined && next.mode !== before.mode) changes.mode = next.mode;
  return changes;
}
