import ts from 'typescript';

const prohibited = (value: number | undefined): boolean => value === 13 || value === 15;

/** Scan syntax, including unused encoders, without confusing local filesystem APIs with SFTP. */
export function sftpPolicyProblems(source: string): string[] {
  const file = ts.createSourceFile(
    'policy.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const problems: string[] = [];
  const constants = new Map<string, number>();
  const writerContext = /SFTPWriter|\.byte\s*\(/i.test(source);
  const numeric = (node: ts.Node | undefined): number | undefined => {
    if (node && ts.isNumericLiteral(node)) return Number(node.text);
    if (node && ts.isIdentifier(node)) return constants.get(node.text);
  };
  const constantText = (node: ts.Node): string | undefined => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constantText(node.left);
      const right = constantText(node.right);
      if (left !== undefined && right !== undefined) return left + right;
    }
  };
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const value = numeric(node.initializer);
      if (value !== undefined) constants.set(node.name.text, value);
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  const visit = (node: ts.Node): void => {
    const text = constantText(node);
    if (text && /(?:posix-rename|hardlink|lsetstat)@openssh\.com/i.test(text))
      problems.push('extension');
    if (ts.isIdentifier(node)) {
      if (/^SSH_FX[PF]_(?:REMOVE|RMDIR|TRUNC|APPEND)$/i.test(node.text)) problems.push('constant');
      if (
        /^(?:REMOVE|RMDIR|TRUNC|APPEND)$/.test(node.text) ||
        (writerContext && /^(?:remove|rmdir|trunc|append)$/i.test(node.text))
      )
        problems.push('packet name');
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (
        /^(?:byte|writeUInt8|writeUint8)$/.test(node.expression.name.text) &&
        prohibited(numeric(node.arguments[0]))
      )
        problems.push('packet writer');
    }
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map(numeric);
      const declared =
        values.length >= 5 && values.slice(0, 4).every((value) => value !== undefined)
          ? values[0]! * 0x1000000 + values[1]! * 0x10000 + values[2]! * 0x100 + values[3]!
          : undefined;
      if (
        (declared === values.length - 4 && prohibited(values[4])) ||
        (/sftp/i.test(source) && prohibited(values[0]))
      )
        problems.push('packet bytes');
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (/\bSSH_FX[PF]_(?:REMOVE|RMDIR|TRUNC|APPEND)\b/i.test(source))
    problems.push('protocol constant');
  if (/(?:posix-rename|hardlink|lsetstat)@openssh\.com/i.test(source))
    problems.push('extension text');
  return problems;
}
