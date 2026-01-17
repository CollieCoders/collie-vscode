import type { DocumentNode } from '../format/parser/ast';
import type { Diagnostic } from '../format/parser/diagnostics';

export interface ParsedDocument {
  ast: DocumentNode;
  diagnostics?: readonly Diagnostic[];
  version: number;
}
