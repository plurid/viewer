import { describe, expect, it } from 'vitest';
import { documentTypes } from '../tools/document-types';
import { modelFormats } from '../src/domain/model-formats';

describe('Finder document types', () => {
  it('offers Viewer in Open With without claiming any type as its default', () => {
    for (const type of documentTypes) {
      expect(type.CFBundleTypeRole).toBe('Viewer');
      expect(type.LSHandlerRank).toBe('Alternate');
      expect(!!type.LSItemContentTypes?.length !== !!type.CFBundleTypeExtensions?.length).toBe(
        true,
      );
    }
    const contentTypes = documentTypes.flatMap((type) => type.LSItemContentTypes ?? []);
    for (const expected of ['public.folder', 'public.image', 'com.adobe.pdf', 'public.text'])
      expect(contentTypes).toContain(expected);
    const extensions = documentTypes.flatMap((type) => type.CFBundleTypeExtensions ?? []);
    expect(extensions).toEqual(expect.arrayContaining(['dxf', ...modelFormats]));
  });
});
