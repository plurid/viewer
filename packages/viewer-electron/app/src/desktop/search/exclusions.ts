import path from 'node:path';

export function searchExclusionRules(rules: readonly string[]) {
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const rule of rules) {
    if (path.isAbsolute(rule)) paths.add(path.resolve(rule));
    else if (rule) names.add(rule);
  }
  return { names, paths };
}

/** Compile once per configuration, before traversal, extraction or watch registration. */
export function searchExclusions(rules: readonly string[]): (file: string) => boolean {
  const { names, paths } = searchExclusionRules(rules);
  const roots = [...paths].map((root) => ({
    root,
    prefix: root.endsWith(path.sep) ? root : root + path.sep,
  }));
  return (file) =>
    file.split(path.sep).some((part) => names.has(part)) ||
    roots.some(({ root, prefix }) => file === root || file.startsWith(prefix));
}
