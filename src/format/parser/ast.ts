export interface RootNode {
  type: 'Root';
  children: Node[];
  props?: PropsDecl;
}

export type Node = ElementNode | TextNode | ExpressionNode | ConditionalNode;

export interface ElementNode {
  type: 'Element';
  name: string;
  classes: string[];
  children: Node[];
}

export interface TextNode {
  type: 'Text';
  parts: TextPart[];
  placement: 'inline' | 'block';
}

export type TextPart = TextChunk | TextExprPart;

export interface TextChunk {
  type: 'text';
  value: string;
}

export interface TextExprPart {
  type: 'expr';
  value: string;
}

export interface ExpressionNode {
  type: 'Expression';
  value: string;
}

export interface ConditionalBranch {
  test?: string;
  body: Node[];
}

export interface ConditionalNode {
  type: 'Conditional';
  branches: ConditionalBranch[];
}

export interface PropsDecl {
  fields: PropsField[];
}

export interface PropsField {
  name: string;
  optional: boolean;
  typeText: string;
}
