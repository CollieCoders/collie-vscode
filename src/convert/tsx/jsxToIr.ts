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
    return convertJsxExpression(node, sourceFile, diagnostics);
  }

  if (ts.isJsxText(node)) {
    const text = normalizeJsxText(node.getText(sourceFile));
    if (!text) {
      return undefined;
    }
    return createIrText(text);
  }

  diagnostics.warnings.push(`Unsupported JSX node omitted: ${ts.SyntaxKind[node.kind]}`);
  return createPlaceholderExpression('Unsupported JSX node', node, sourceFile);
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

function convertJsxExpression(
  node: ts.JsxExpression,
  sourceFile: ts.SourceFile,
  diagnostics: JsxConversionDiagnostics
) {
  const expression = node.expression;
  if (!expression) {
    return undefined;
  }

  if (containsJsx(expression)) {
    diagnostics.warnings.push(
      `Converted complex JSX expression to placeholder: ${summarizeNodeText(expression, sourceFile)}`
    );
    return createIrExpression(buildPlaceholderText('complex expression', expression, sourceFile));
  }

  return createIrExpression(expression.getText(sourceFile));
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
      const value = convertAttributeValue(attribute.initializer, sourceFile, diagnostics);
      props.push(createIrProp(name, value));
      continue;
    }

    if (ts.isJsxSpreadAttribute(attribute)) {
      if (containsJsx(attribute.expression)) {
        diagnostics.warnings.push(
          `Spread attribute contains JSX. Inserted placeholder: ${summarizeNodeText(attribute.expression, sourceFile)}`
        );
        props.push(createIrExpression(buildPlaceholderText('spread attribute', attribute.expression, sourceFile)));
        continue;
      }
      const spreadText = `...${attribute.expression.getText(sourceFile)}`;
      props.push(createIrExpression(spreadText));
      continue;
    }

    diagnostics.warnings.push(`Unsupported JSX attribute omitted: ${ts.SyntaxKind[attribute.kind]}`);
    props.push(createPlaceholderExpression('unsupported JSX attribute', attribute, sourceFile));
  }

  return props;
}

function convertAttributeValue(
  initializer: ts.JsxAttributeValue | undefined,
  sourceFile: ts.SourceFile,
  diagnostics: JsxConversionDiagnostics
) {
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
    if (containsJsx(initializer.expression)) {
      diagnostics.warnings.push(
        `Prop value contains JSX. Inserted placeholder: ${summarizeNodeText(initializer.expression, sourceFile)}`
      );
      return `{${buildPlaceholderText('prop value', initializer.expression, sourceFile)}}`;
    }
    return `{${initializer.expression.getText(sourceFile)}}`;
  }

  if (containsJsx(initializer)) {
    diagnostics.warnings.push(
      `Prop initializer contains JSX. Inserted placeholder: ${summarizeNodeText(initializer, sourceFile)}`
    );
    return `{${buildPlaceholderText('prop initializer', initializer, sourceFile)}}`;
  }

  return initializer.getText(sourceFile);
}

function containsJsx(node: ts.Node): boolean {
  let found = false;

  const visit = (current: ts.Node) => {
    if (
      ts.isJsxElement(current) ||
      ts.isJsxSelfClosingElement(current) ||
      ts.isJsxFragment(current) ||
      ts.isJsxExpression(current)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  };

  visit(node);
  return found;
}

const PLACEHOLDER_PREFIX = '/* Collie TODO: ';
const PLACEHOLDER_SUFFIX = ' */';

function buildPlaceholderText(reason: string, node: ts.Node, sourceFile: ts.SourceFile) {
  const preview = summarizeNodeText(node, sourceFile);
  return `${PLACEHOLDER_PREFIX}${reason}${preview ? ` — ${preview}` : ''}${PLACEHOLDER_SUFFIX}`;
}

function createPlaceholderExpression(reason: string, node: ts.Node, sourceFile: ts.SourceFile) {
  return createIrExpression(buildPlaceholderText(reason, node, sourceFile));
}

function summarizeNodeText(node: ts.Node, sourceFile: ts.SourceFile) {
  const raw = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  if (!raw) {
    return '';
  }

  const max = 80;
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}
*** End Patch
    if (
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      ts.isJsxFragment(child) ||
      ts.isJsxExpression(child)
    ) {
      found = true;
      return;
    }
    child.forEachChild(visit);
  };

  node.forEachChild(visit);
  return found;
}

const PLACEHOLDER_PREFIX = '/* Collie TODO: ';
const PLACEHOLDER_SUFFIX = ' */';

function buildPlaceholderText(reason: string, node: ts.Node, sourceFile: ts.SourceFile) {
  const preview = summarizeNodeText(node, sourceFile);
  return `${PLACEHOLDER_PREFIX}${reason}${preview ? ` — ${preview}` : ''}${PLACEHOLDER_SUFFIX}`;
}

function createPlaceholderExpression(reason: string, node: ts.Node, sourceFile: ts.SourceFile) {
  return createIrExpression(buildPlaceholderText(reason, node, sourceFile));
}

function summarizeNodeText(node: ts.Node, sourceFile: ts.SourceFile) {
  const raw = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  if (!raw) {
    return '';
  }

  const max = 80;
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
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
