import ts from 'typescript';

export type PageScopeReason = 'outside' | 'unresolved';

export interface PageScopeProblem {
  file: string;
  line: number;
  name: string;
  reason: PageScopeReason;
}

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
  noEmit: true,
  skipLibCheck: true,
};

/** The function a `pageCall` sends: written inline, or declared in the same file. */
function pageFunction(argument: ts.Expression, checker: ts.TypeChecker) {
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return argument;
  if (!ts.isIdentifier(argument)) return undefined;
  const declaration = checker.getSymbolAtLocation(argument)?.declarations?.[0];
  if (declaration && ts.isFunctionDeclaration(declaration)) return declaration;
  if (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) ||
      ts.isFunctionExpression(declaration.initializer))
  )
    return declaration.initializer;
  return undefined;
}

function inType(node: ts.Node, root: ts.Node): boolean {
  for (let parent = node.parent; parent && parent !== root; parent = parent.parent)
    if (
      ts.isTypeNode(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent)
    )
      return true;
  return false;
}

/** Whether `node` names a property, not a binding. */
function propertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node)
  );
}

/**
 * Names that page functions use but that are declared in their file outside them. `pageCall`
 * sends only the function's own source to the page, so such a name is undefined there, and type
 * checks cannot tell. Types are erased, so they may come from anywhere. `sources` stands in for
 * files on disk.
 */
export function pageScopeProblems(
  files: string[],
  sources = new Map<string, string>(),
): PageScopeProblem[] {
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => sources.has(file) || fileExists(file);
  host.readFile = (file) => sources.get(file) ?? readFile(file);
  host.getSourceFile = (file, language, ...rest) => {
    const text = sources.get(file);
    return text === undefined
      ? getSourceFile(file, language, ...rest)
      : ts.createSourceFile(file, text, language);
  };
  const program = ts.createProgram(files, options, host);
  const checker = program.getTypeChecker();
  const problems: PageScopeProblem[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file)!;
    const report = (node: ts.Node, name: string, reason: PageScopeReason) =>
      problems.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        name,
        reason,
      });
    const inspect = (fn: ts.FunctionLikeDeclaration, node: ts.Node) => {
      if (ts.isIdentifier(node) && !propertyName(node) && !inType(node, fn)) {
        const symbol = ts.isShorthandPropertyAssignment(node.parent)
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
        const outside = symbol?.declarations?.some(
          (declaration) =>
            declaration.getSourceFile() === source &&
            (declaration.pos < fn.pos || declaration.end > fn.end),
        );
        if (outside) report(node, node.text, 'outside');
      }
      ts.forEachChild(node, (child) => inspect(fn, child));
    };
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'pageCall' &&
        node.arguments[0]
      ) {
        const fn = pageFunction(node.arguments[0], checker);
        if (fn) ts.forEachChild(fn, (child) => inspect(fn, child));
        else report(node, node.arguments[0].getText(source), 'unresolved');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return problems;
}
