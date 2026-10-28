import type { Plugin } from 'vite';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const selector = `var getTransform = createSelector(
  [
    getRotationX,
    getRotationY,
    getTranslationX,
    getTranslationY,
    getTranslationZ,
    getScale
  ],
  (rotationX, rotationY, translationX, translationY, translationZ, scale) => ({
    rotationX,
    rotationY,
    translationX,
    translationY,
    translationZ,
    scale
  })
);`;

/** Camera primitives are strong Map keys in Reselect. Bound both caches without
 * changing stable-input identity or editing the installed Plurid distribution. */
export function boundPluridCamera(code: string): string {
  const variants = [selector, selector.replace('= createSelector(', '= toolkit.createSelector(')];
  const matches = variants.filter((variant) => code.includes(variant));
  const selected = matches[0];
  if (matches.length !== 1 || !selected || code.split(selected).length !== 2)
    throw new Error('Review the Plurid camera selector cache after updating Plurid.');
  return code.replace(
    selected,
    selected.replace(
      '  })\n);',
      '  }),\n  { memoizeOptions: { maxSize: 16 }, argsMemoizeOptions: { maxSize: 16 } }\n);',
    ),
  );
}

type PluridExtension = '.js' | '.mjs';

export async function pluridCameraSource(extension: PluridExtension = '.js'): Promise<string> {
  const directory = path.dirname(createRequire(import.meta.url).resolve('@plurid/plurid-react'));
  const candidates = await Promise.all(
    (await readdir(directory))
      .filter((file) => file.startsWith('chunk-') && file.endsWith(extension))
      .map((file) => readFile(path.join(directory, file), 'utf8')),
  );
  const owners = candidates.filter((code) =>
    /var getTransform = (?:toolkit\.)?createSelector\(/.test(code),
  );
  if (owners.length !== 1)
    throw new Error('Review the Plurid camera selector owner after updating Plurid.');
  return owners[0]!;
}

export function pluridCameraCache(): Plugin {
  let transformed = false;
  const transform = (code: string, id: string) => {
    if (
      !/[/\\]@plurid[/\\]plurid-react[/\\]distribution[/\\]/.test(id) ||
      !/var getTransform = (?:toolkit\.)?createSelector\(/.test(code)
    )
      return;
    const bounded = boundPluridCamera(code);
    transformed = true;
    return { code: bounded, map: null };
  };
  return {
    name: 'viewer-plurid-camera-cache',
    enforce: 'pre',
    transform,
    async buildStart() {
      for (const extension of ['.js', '.mjs'] as const)
        boundPluridCamera(await pluridCameraSource(extension));
    },
    generateBundle() {
      if (!transformed)
        throw new Error('The renderer build did not apply the reviewed Plurid camera cache.');
    },
    // Dependency prebundling happens before Vite's ordinary transform hooks.
    config: () => ({
      optimizeDeps: {
        rolldownOptions: { plugins: [{ name: 'viewer-plurid-camera-cache', transform }] },
      },
    }),
  };
}
