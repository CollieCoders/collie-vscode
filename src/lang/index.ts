import type { RootNode } from '../format/parser/ast';
import type { Diagnostic } from '../format/parser/diagnostics';

export interface ParsedDocument {
  ast: RootNode;
  diagnostics?: readonly Diagnostic[];
  version: number;
}
