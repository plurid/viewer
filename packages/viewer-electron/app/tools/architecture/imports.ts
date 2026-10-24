import { builtinModules } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export interface ImportViolation {
  file: string;
  specifier: string;
  reason: string;
}

export interface ArchitectureReport {
  files: number;
  violations: ImportViolation[];
  cycles: string[][];
}

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
const platformImport = (name: string) =>
  name.startsWith('node:') || builtins.has(name) || name === 'electron';
const reactImport = (name: string) =>
  name === 'react' || name.startsWith('react/') || name.startsWith('react-dom');

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(file);
      return /\.tsx?$/.test(entry.name) ? [file] : [];
    }),
  );
  return nested.flat();
}

function runtimeImport(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node))
    return (
      !node.isTypeOnly &&
      (!node.exportClause ||
        !ts.isNamedExports(node.exportClause) ||
        node.exportClause.elements.some((item) => !item.isTypeOnly))
    );
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings))
    return true;
  return clause.namedBindings.elements.some((item) => !item.isTypeOnly);
}

/** Inspect source imports, including type-only imports, without loading application code. */
export async function inspectImports(root: string): Promise<ArchitectureReport> {
  const files = await sourceFiles(root);
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  const violations: ImportViolation[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const relative = path.relative(root, file).split(path.sep).join('/');
    const edges: string[] = [];
    const inspect = (specifier: string, runtime: boolean) => {
      const base = path.resolve(path.dirname(file), specifier);
      const target = specifier.startsWith('.')
        ? [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find((item) =>
            known.has(item),
          )
        : undefined;
      const targetName = target ? path.relative(root, target).split(path.sep).join('/') : '';
      let reason: string | undefined;
      if (relative.startsWith('domain/')) {
        if (platformImport(specifier) || reactImport(specifier))
          reason = 'Domain code must be independent of Node, Electron and React.';
        else if (targetName && !targetName.startsWith('domain/'))
          reason = 'Domain code must not depend on desktop or renderer adapters.';
      } else if (relative.startsWith('renderer/') || relative === 'renderer.tsx') {
        if (platformImport(specifier) || targetName.startsWith('desktop/'))
          reason = 'Renderer code must reach native services through the typed preload API.';
        else if (specifier.includes('/tools/'))
          reason = 'Build and test tools do not belong in the renderer.';
      } else if (relative.startsWith('desktop/') && reactImport(specifier)) {
        reason = 'Desktop code must be independent of React rendering.';
      }
      if (reason) violations.push({ file: relative, specifier, reason });
      if (runtime && target) edges.push(target);
    };
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        inspect(node.moduleSpecifier.text, runtimeImport(node));
      else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]!)
      )
        // Lazy imports share dependency rules, but cannot create an initialization cycle.
        inspect(node.arguments[0].text, false);
      ts.forEachChild(node, visit);
    };
    visit(source);
    graph.set(file, edges);
  }
  const cycles: string[][] = [];
  const active = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (file: string): void => {
    if (active.has(file)) {
      cycles.push(
        [...stack.slice(stack.indexOf(file)), file].map((item) => path.relative(root, item)),
      );
      return;
    }
    if (visited.has(file)) return;
    active.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    stack.pop();
    active.delete(file);
    visited.add(file);
  };
  for (const file of files) visit(file);
  return { files: files.length, violations, cycles };
}
