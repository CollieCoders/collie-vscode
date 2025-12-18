import type { SourceSpan } from './diagnostics';

export interface RootNode {
  type: 'Root';
  children: Node[];
  props?: PropsDecl;
  span?: SourceSpan;
}

export type Node = ElementNode | TextNode | ExpressionNode | ConditionalNode;

export interface ElementNode {
  type: 'Element';
  name: string;
  classes: string[];
  children: Node[];
  span?: SourceSpan;
}

export interface TextNode {
  type: 'Text';
  parts: TextPart[];
  placement: 'inline' | 'block';
  span?: SourceSpan;
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
  span?: SourceSpan;
}

export interface ConditionalBranch {
  test?: string;
  body: Node[];
  span?: SourceSpan;
}

export interface ConditionalNode {
  type: 'Conditional';
  branches: ConditionalBranch[];
  span?: SourceSpan;
}

export interface PropsDecl {
  fields: PropsField[];
  span?: SourceSpan;
}

export interface PropsField {
  name: string;
  optional: boolean;
  typeText: string;
}
