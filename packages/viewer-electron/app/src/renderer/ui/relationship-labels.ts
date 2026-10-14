import type { FileRelation } from '../../domain/relationships';
export const relationshipBasis: Record<FileRelation['basis'], string> = {
  observed: 'Recorded operation',
  declared: 'Declared link',
  reported: 'User note',
  inferred: 'Suggested link',
};
