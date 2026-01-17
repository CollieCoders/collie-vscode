import type {
  ClassAliasesDecl,
  ConditionalBranch,
  ConditionalNode,
  DocumentNode,
  ElementNode,
  ForLoopNode,
  Node,
  RootNode
} from './ast';
import type { Diagnostic, SourceSpan } from './diagnostics';

export interface ParseResult {
  document: DocumentNode;
  diagnostics: Diagnostic[];
}

export interface ConditionalBranchContext {
  kind: 'ConditionalBranch';
  owner: ConditionalNode;
  branch: ConditionalBranch;
  children: Node[];
}

export interface ForLoopContext {
  kind: 'ForLoop';
  owner: ForLoopNode;
  children: Node[];
}

export type ParentNode = RootNode | ElementNode | ConditionalBranchContext | ForLoopContext;

export interface StackItem {
  node: ParentNode;
  level: number;
}

export interface BranchLocation {
  branch: ConditionalBranch;
  span: SourceSpan;
}

export interface ConditionalChainState {
  node: ConditionalNode;
  level: number;
  hasElse: boolean;
}

export interface ConditionalHeaderResult {
  test?: string;
  inlineBody?: string;
  inlineColumn?: number;
  span: SourceSpan;
}
