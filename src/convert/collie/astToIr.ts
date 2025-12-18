import type {
  ConditionalNode,
  ElementNode,
  ExpressionNode,
  Node,
  PropsDecl,
  RootNode,
  TextNode,
  TextPart
} from '../../format/parser/ast';
import {
  createIrConditional,
  createIrConditionalBranch,
  createIrElement,
  createIrExpression,
  createIrText,
  type IrNode
} from '../ir/nodes';

export function convertCollieAstToIr(root: RootNode): readonly IrNode[] {
  const nodes: IrNode[] = [];

  if (root.props) {
    nodes.push(createIrExpression(buildPropsComment(root.props)));
  }

  nodes.push(...convertNodes(root.children));
  return nodes;
}

function convertNodes(nodes: readonly Node[]): IrNode[] {
  const irNodes: IrNode[] = [];

  for (const node of nodes) {
    irNodes.push(...convertNode(node));
  }

  return irNodes;
}

function convertNode(node: Node): readonly IrNode[] {
  switch (node.type) {
    case 'Element':
      return [convertElementNode(node)];
    case 'Text':
      return convertTextNode(node);
    case 'Expression':
      return [convertExpressionNode(node)];
    case 'Conditional':
      return [convertConditionalNode(node)];
    default:
      return [createFallbackComment(`Unsupported Collie node: ${node.type}`)];
  }
}

function convertElementNode(node: ElementNode): IrNode {
  const children = convertNodes(node.children);
  return createIrElement(node.name, {
    classes: node.classes,
    children
  });
}

function convertTextNode(node: TextNode): IrNode[] {
  const segments: IrNode[] = [];
  let pendingText = '';

  const flushText = () => {
    if (!pendingText) {
      return;
    }
    segments.push(createIrText(pendingText));
    pendingText = '';
  };

  for (const part of node.parts) {
    if (isTextChunk(part)) {
      pendingText += part.value;
      continue;
    }

    flushText();
    segments.push(createIrExpression(part.value));
  }

  flushText();
  return segments;
}

function convertExpressionNode(node: ExpressionNode) {
  return createIrExpression(node.value);
}

function convertConditionalNode(node: ConditionalNode): IrNode {
  const branches = node.branches.map(branch =>
    createIrConditionalBranch(branch.test, convertNodes(branch.body))
  );
  return createIrConditional(branches);
}

function isTextChunk(part: TextPart): part is Extract<TextPart, { type: 'text' }> {
  return part.type === 'text';
}

function buildPropsComment(props: PropsDecl): string {
  if (!props.fields.length) {
    return '/* Collie props block present. Add TypeScript props manually. */';
  }

  const summary = props.fields
    .map(field => `${field.name}${field.optional ? '?' : ''}: ${field.typeText}`)
    .join(', ');
  return `/* Collie props: ${summary} */`;
}

function createFallbackComment(reason: string) {
  return createIrExpression(`/* Collie TODO: ${reason} */`);
}
