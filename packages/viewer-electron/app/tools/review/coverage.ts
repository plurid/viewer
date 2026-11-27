/**
 * What the app has, read from its source, beside what the scenes show: every registry command,
 * every dialog, Settings section and preview kind. A command is an object literal with an `id`, a
 * `label`, a `group` and a `run` under src/renderer; a dialog is a use of the shared `Dialog`, or
 * a native `<dialog>`, named by the component that draws it.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { categories } from '../../src/domain/preferences/catalog';
import { filePreviewModules } from '../../src/domain/previews/formats';
import type { Coverage, CoverageEntry, SceneResult } from './types';

export interface CatalogEntry {
  id: string;
  label: string;
  /** Where it is declared, relative to the app folder. */
  source: string;
}

export interface Catalog {
  commands: CatalogEntry[];
  /** `label` is the dialog's title as written, which the page shows as its accessible name. */
  dialogs: CatalogEntry[];
  settings: CatalogEntry[];
  previews: CatalogEntry[];
}

/** An expression as a reader would see it: literal text, `*` where a value is filled in. */
function spelled(node: ts.Expression | undefined, file: ts.SourceFile): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return node.head.text + node.templateSpans.map((span) => '*' + span.literal.text).join('');
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return undefined;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return (spelled(node.left, file) ?? '*') + (spelled(node.right, file) ?? '*');
  return '*';
}

function property(node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const item of node.properties)
    if (ts.isPropertyAssignment(item) && ts.isIdentifier(item.name) && item.name.text === name)
      return item.initializer;
  return undefined;
}

function hasMember(node: ts.ObjectLiteralExpression, name: string): boolean {
  return node.properties.some(
    (item) =>
      (ts.isPropertyAssignment(item) || ts.isMethodDeclaration(item)) &&
      ts.isIdentifier(item.name) &&
      item.name.text === name,
  );
}

/** The name of the function or component a node is written in. */
function enclosingName(node: ts.Node): string | undefined {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text;
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isVariableDeclaration(parent.parent) &&
      ts.isIdentifier(parent.parent.name)
    )
      return parent.parent.name.text;
  }
  return undefined;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter(
      (entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts'),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/** Reads the app's commands, dialogs, Settings sections and preview kinds. */
export async function readCatalog(appRoot: string): Promise<Catalog> {
  const commands = new Map<string, CatalogEntry>();
  const dialogs = new Map<string, CatalogEntry>();
  for (const file of await sourceFiles(path.join(appRoot, 'src/renderer'))) {
    const text = await readFile(file, 'utf8');
    const source = path.relative(appRoot, file);
    const parsed = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.ESNext,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isObjectLiteralExpression(node) &&
        hasMember(node, 'id') &&
        hasMember(node, 'label') &&
        hasMember(node, 'group') &&
        hasMember(node, 'run')
      ) {
        const id = spelled(property(node, 'id'), parsed);
        if (id && !commands.has(id))
          commands.set(id, {
            id,
            label: spelled(property(node, 'label'), parsed) ?? '(label set by context)',
            source,
          });
      }
      const element = ts.isJsxElement(node)
        ? node.openingElement
        : ts.isJsxSelfClosingElement(node)
          ? node
          : undefined;
      if (element) {
        const tag = element.tagName.getText(parsed);
        if ((tag === 'Dialog' || tag === 'dialog') && !source.endsWith('ui/primitives.tsx')) {
          const title = element.attributes.properties.find(
            (item): item is ts.JsxAttribute =>
              ts.isJsxAttribute(item) &&
              item.name.getText(parsed) === (tag === 'Dialog' ? 'title' : 'aria-label'),
          );
          const value = title?.initializer;
          const label =
            value && ts.isStringLiteral(value)
              ? value.text
              : value && ts.isJsxExpression(value)
                ? (spelled(value.expression, parsed) ?? '*')
                : '*';
          const component = enclosingName(node) ?? path.basename(file);
          const id = dialogs.has(component) ? component + ': ' + label : component;
          dialogs.set(id, { id, label, source });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  return {
    commands: [...commands.values()].sort((a, b) => a.id.localeCompare(b.id)),
    dialogs: [...dialogs.values()].sort((a, b) => a.id.localeCompare(b.id)),
    settings: [...categories, 'License'].map((category) => ({
      id: category,
      label: category,
      source: 'src/domain/preferences/catalog.ts',
    })),
    previews: filePreviewModules.map((module) => ({
      id: module.id,
      label: module.label,
      source: 'src/domain/previews/formats.ts',
    })),
  };
}

/** Whether a dialog title as written, with `*` for filled-in parts, names this shown title. */
function titleMatches(written: string, shown: string): boolean {
  if (written === '*') return false;
  const pattern = written
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.+');
  // letter case aside, as for commands
  return new RegExp('^' + pattern + '$', 'i').test(shown);
}

/** Which scenes show each catalog entry: what scenes declare, the commands their steps ran and
 * the dialogs their captures had open. */
export function coverage(catalog: Catalog, scenes: readonly SceneResult[]): Coverage {
  const completed = scenes
    .filter((scene) => !scene.blocked)
    .map((scene) => ({
      ...scene,
      captures: scene.captures.filter(
        (capture) => capture.image && !capture.error && !capture.newerBuild,
      ),
    }))
    .filter((scene) => scene.captures.length > 0);
  const entries = (
    list: CatalogEntry[],
    shown: (entry: CatalogEntry, scene: SceneResult) => boolean,
  ) =>
    list.map((entry): CoverageEntry => ({
      id: entry.id,
      label: entry.label,
      scenes: completed.filter((scene) => shown(entry, scene)).map((scene) => scene.id),
    }));
  // letter case aside: labels move between title and sentence case
  const ran = (scene: SceneResult) =>
    new Set(
      scene.captures.flatMap((capture) => capture.commands.map((label) => label.toLowerCase())),
    );
  const opened = (scene: SceneResult) => scene.captures.flatMap((capture) => capture.dialogs);
  return {
    commands: entries(
      catalog.commands,
      (entry, scene) =>
        !!scene.covers.commands?.includes(entry.id) || ran(scene).has(entry.label.toLowerCase()),
    ),
    dialogs: entries(
      catalog.dialogs,
      (entry, scene) =>
        !!scene.covers.dialogs?.includes(entry.id) ||
        opened(scene).some((title) => titleMatches(entry.label, title)),
    ),
    settings: entries(
      catalog.settings,
      (entry, scene) => !!scene.covers.settings?.includes(entry.id),
    ),
    previews: entries(
      catalog.previews,
      (entry, scene) => !!scene.covers.previews?.includes(entry.id),
    ),
  };
}
