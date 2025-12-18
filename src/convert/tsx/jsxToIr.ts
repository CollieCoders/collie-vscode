import * as ts from 'typescript';
import {
  createIrElement,
  createIrExpression,
  createIrFragment,
  createIrProp,
  createIrText,
  type IrExpression,
  type IrNode,
  type IrProp
} from '../ir/nodes';

export interface JsxConversionDiagnostics {
  readonly warnings: string[];
}

export interface JsxToIrResult {
  readonly nodes: readonly IrNode[];
  readonly diagnostics: JsxConversionDiagnostics;
}

export function convertJsxNodesToIr(
  nodes: readonly ts.JsxChild[],
  sourceFile: ts.SourceFile
): JsxToIrResult {
  const diagnostics: JsxConversionDiagnostics = { warnings: [] };
  const irNodes: IrNode[] = [];

  for (const node of nodes) {
    const converted = convertJsxChild(node, sourceFile, diagnostics);
    if (converted) {
      irNodes.push(converted);
    }
  }

  return { nodes: irNodes, diagnostics };
}

function convertJsxChild(
  node: ts.JsxChild,
  sourceFile: ts.SourceFile,
  diagnostics: JsxConversionDiagnostics
): IrNode | undefined {
  if (ts.isJsxElement(node)) {
    return convertJsxElement(node, sourceFile, diagnostics);
  }

  if (ts.isJsxSelfClosingElement(node)) {
    return convertJsxSelfClosingElement(node, sourceFile, diagnostics);
  }

  if (ts.isJsxFragment(node)) {
    return convertJsxFragment(node, sourceFile, diagnostics);
  }

  if (ts.isJsxExpression(node)) {
    const expression = node.expression;
    if (!expression) {
      return undefined;
    }
    return createIrExpression(expression.getText(sourceFile));
  }

  if (ts.isJsxText(node)) {
    const text = normalizeJsxText(node.getText(sourceFile));
    if (!text) {
      return undefined;
    }
    return createIrText(text);
  }

  diagnostics.warnings.push(`Unsupported JSX node omitted: ${ts.SyntaxKind[node.kind]}`);
  return undefined;
}

function convertJsxElement(
  node: ts.JsxElement,
  sourceFile: ts.SourceFile,
  diagnostics: JsxConversionDiagnostics
) {
  const tagName = node.openingElement.tagName.getText(sourceFile);
  const props = convertJsxAttributes(node.openingElement.attributes, sourceFile, diagnostics);
  const children = convertJsxChildren(node.children, sourceFile, diagnostics);
  const { normalizedProps, classes } = normalizeProps(props);

  return createIrElement(tagName, {
    classes,
    props: normalizedProps,
    children
  });
}

function convertJsxSelfClosingElement(
  node: ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
  diagnostics: JsxConversionDiagnostics
) {
  const tagName = node.tagName.getText(sourceFile);
  const props = convertJsxAttributes(node.attributes, sourceFile, diagnostics);
  const { normalizedProps, classes } = normalizeProps(props);

  return createIrElement(tagName, {
    classes,
    props: normalizedProps,
    children: []
  });
}

function convertJsxFragment(
  node: ts.JsxFragment,
  sourceFile: ts.SourceFile,
  diagnostics: JsxConversionDiagnostics
) {
  const children = convertJsxChildren(node.children, sourceFile, diagnostics);
  return createIrFragment(children);
}

function convertJsxChildren(
  children: readonly ts.JsxChild[],
  sourceFile: ts.SourceFile,
  diagnostics: JsxConversionDiagnostics
): IrNode[] {
  const result: IrNode[] = [];

  for (const child of children) {
    const converted = convertJsxChild(child, sourceFile, diagnostics);
    if (converted) {
      result.push(converted);
    }
  }

  return result;
}

function convertJsxAttributes(
  attributes: ts.JsxAttributes,
  sourceFile: ts.SourceFile,
  diagnostics: JsxConversionDiagnostics
) {
  const props: (IrProp | IrExpression)[] = [];

  for (const attribute of attributes.properties) {
    if (ts.isJsxAttribute(attribute)) {
      const name = attribute.name.getText(sourceFile);
      const value = convertAttributeValue(attribute.initializer, sourceFile);
      props.push(createIrProp(name, value));
      continue;
    }

    if (ts.isJsxSpreadAttribute(attribute)) {
      const spreadText = `...${attribute.expression.getText(sourceFile)}`;
      props.push(createIrExpression(spreadText));
      continue;
    }

    diagnostics.warnings.push(`Unsupported JSX attribute omitted: ${ts.SyntaxKind[attribute.kind]}`);
  }

  return props;
}

function convertAttributeValue(initializer: ts.JsxAttributeValue | undefined, sourceFile: ts.SourceFile) {
  if (!initializer) {
    return undefined;
  }

  if (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) {
    return initializer.getText(sourceFile);
  }

  if (ts.isJsxExpression(initializer)) {
    if (!initializer.expression) {
      return undefined;
    }
    return `{${initializer.expression.getText(sourceFile)}}`;
  }

  return initializer.getText(sourceFile);
}

function normalizeProps(props: readonly (IrProp | IrExpression)[]) {
  const normalizedProps: (IrProp | IrExpression)[] = [];
  const classes: string[] = [];

  for (const prop of props) {
    if (prop.kind === 'prop' && prop.name === 'className' && prop.value) {
      const classTokens = extractClassTokens(prop.value);
      if (classTokens) {
        classes.push(...classTokens);
        continue;
      }
    }

    normalizedProps.push(prop);
  }

  return { normalizedProps, classes };
}

function extractClassTokens(value: string): string[] | undefined {
  const literal = unwrapStringLiteral(value);
  if (literal === undefined) {
    return undefined;
  }

  const tokens = literal
    .split(/\s+/g)
    .map(token => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return undefined;
  }

  return tokens;
}

function unwrapStringLiteral(value: string): string | undefined {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('`') && value.endsWith('`'))
  ) {
    return value.slice(1, -1);
  }

  return undefined;
}

function normalizeJsxText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}
