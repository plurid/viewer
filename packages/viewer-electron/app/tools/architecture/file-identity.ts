import path from 'node:path';
import ts from 'typescript';

export interface IdentityViolation {
  file: string;
  line: number;
  reason: string;
}

const implementations = new Set([
  'src/domain/files/item-identity.ts',
  'src/desktop/files/item-identity.ts',
  'src/desktop/files/stats.ts',
]);

/** The compiler follows namespace imports, aliases and descriptor reads. A spelling-only rule
 * would miss fs.stat and handle.stat, or reject harmless metadata-only stat calls. */
export function inspectStatIdentity(
  app: string,
  overrides: ReadonlyMap<string, string> = new Map(),
): IdentityViolation[] {
  const config = ts.readConfigFile(path.join(app, 'tsconfig.main.json'), ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, app);
  const host = ts.createCompilerHost(parsed.options);
  const read = host.readFile;
  host.readFile = (file) => overrides.get(path.resolve(file)) ?? read(file);
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const checker = program.getTypeChecker();
  const violations: IdentityViolation[] = [];
  const isNumber = (type: ts.Type): boolean =>
    type.isUnion() ? type.types.some(isNumber) : (type.flags & ts.TypeFlags.NumberLike) !== 0;
  for (const source of program.getSourceFiles()) {
    const file = path.relative(app, source.fileName).split(path.sep).join('/');
    if (!file.startsWith('src/') || implementations.has(file)) continue;
    const report = (node: ts.Node, reason: string) => violations.push({
      file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason,
    });
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && ['dev', 'ino'].includes(node.name.text))
        report(node, 'Device/inode reads belong to the shared exact-identity implementation.');
      if (ts.isCallExpression(node)) {
        const declaration = checker.getResolvedSignature(node)?.declaration;
        const owner = declaration && path.relative(app, declaration.getSourceFile().fileName).split(path.sep).join('/');
        if (owner && implementations.has(owner)) {
          for (const argument of node.arguments) {
            const type = checker.getTypeAtLocation(argument);
            const inode = type.getProperty('ino');
            if (inode && isNumber(checker.getTypeOfSymbolAtLocation(inode, argument)))
              report(argument, 'Identity requires a BigInt stat from files/stats, including descriptor reads.');
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}
