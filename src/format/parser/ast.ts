import type { SourceSpan } from './diagnostics';

export interface ClassAliasDecl {
  name: string;
  classes: string[];
  span?: SourceSpan;
  nameSpan?: SourceSpan;
}

export interface ClassAliasesDecl {
  aliases: ClassAliasDecl[];
  span?: SourceSpan;
}

export interface RootNode {
  type: 'Root';
  children: Node[];
  inputs?: InputsDecl;
  classAliases?: ClassAliasesDecl;
  id?: string;
  rawId?: string;
  idSpan?: SourceSpan;
  span?: SourceSpan;
}

export interface DocumentNode {
  type: 'Document';
  sections: RootNode[];
  span?: SourceSpan;
}

export type Node = ElementNode | TextNode | ExpressionNode | ConditionalNode | ForLoopNode;

export interface ElementNode {
  type: 'Element';
  name: string;
  classes: string[];
  children: Node[];
  attributes?: string[];
  attributeLines?: string[];
  span?: SourceSpan;
  nameSpan?: SourceSpan;
  classSpans?: SourceSpan[];
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
  span?: SourceSpan;
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

export interface ForLoopNode {
  type: 'ForLoop';
  variable: string;
  iterable: string;
  body: Node[];
  span?: SourceSpan;
}

export interface InputsDecl {
  fields: InputsField[];
  span?: SourceSpan;
}

export interface InputsField {
  name: string;
  optional: boolean;
  typeText: string;
  kind?: 'fn' | 'value';
  span?: SourceSpan;
}
