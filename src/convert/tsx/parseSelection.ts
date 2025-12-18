import * as ts from 'typescript';

const VIRTUAL_SOURCE_FILE = '__collie_selection.tsx';
const WRAPPER_IDENTIFIER = '__CollieTemp';
const WRAPPER_PREFIX = `const ${WRAPPER_IDENTIFIER} = () => (<>`;
const WRAPPER_SUFFIX = '</>);';

export class JsxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsxParseError';
  }
}

export interface JsxParseResult {
  readonly sourceFile: ts.SourceFile;
  readonly rootNodes: readonly ts.JsxChild[];
}

export function parseJsxSelection(selection: string): JsxParseResult {
  const wrappedSource = wrapSelection(selection);
  const sourceFile = ts.createSourceFile(
    VIRTUAL_SOURCE_FILE,
    wrappedSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  if (sourceFile.parseDiagnostics.length > 0) {
    const [firstDiagnostic] = sourceFile.parseDiagnostics;
    const message = ts.flattenDiagnosticMessageText(firstDiagnostic.messageText, '\n');
    throw new JsxParseError(`Unable to parse the selected JSX: ${message}`);
  }

  const rootNodes = extractRootNodes(sourceFile);
  if (rootNodes.length === 0) {
    throw new JsxParseError('No JSX content detected in the selection.');
  }

  return { sourceFile, rootNodes };
}

function wrapSelection(selection: string): string {
  return `${WRAPPER_PREFIX}${selection}${WRAPPER_SUFFIX}`;
}

function extractRootNodes(sourceFile: ts.SourceFile): ts.JsxChild[] {
  const wrapperArrow = findWrapperArrow(sourceFile);
  if (!wrapperArrow) {
    return [];
  }

  const expression = getArrowReturnExpression(wrapperArrow);
  if (!expression) {
    return [];
  }

  if (ts.isJsxFragment(expression)) {
    return filterWhitespaceText(expression.children, sourceFile);
  }

  if (isSupportedJsxChild(expression)) {
    return [expression];
  }

  return [];
}

function findWrapperArrow(sourceFile: ts.SourceFile): ts.ArrowFunction | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== WRAPPER_IDENTIFIER) {
        continue;
      }

      if (!declaration.initializer || !ts.isArrowFunction(declaration.initializer)) {
        continue;
      }
      return declaration.initializer;
    }
  }

  return undefined;
}

function getArrowReturnExpression(arrow: ts.ArrowFunction): ts.Expression | undefined {
  if (ts.isBlock(arrow.body)) {
    const returnStatement = arrow.body.statements.find(ts.isReturnStatement);
    if (!returnStatement?.expression) {
      return undefined;
    }
    return stripParentheses(returnStatement.expression);
  }
  return stripParentheses(arrow.body);
}

function stripParentheses(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;
  while (ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isSupportedJsxChild(node: ts.Node): node is ts.JsxChild {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node) ||
    ts.isJsxExpression(node) ||
    ts.isJsxText(node)
  );
}

function filterWhitespaceText(nodes: readonly ts.JsxChild[], sourceFile: ts.SourceFile): ts.JsxChild[] {
  const result: ts.JsxChild[] = [];
  for (const node of nodes) {
    if (ts.isJsxText(node)) {
      if (node.getText(sourceFile).trim().length === 0) {
        continue;
      }
    }
    result.push(node);
  }

  return result;
}
