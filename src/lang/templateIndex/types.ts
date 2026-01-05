import { Range, Uri } from 'vscode';

export interface TemplateLocation {
  id: string;
  uri: Uri;
  idRange: Range;
  blockRange: Range;
  isValidId: boolean;
}
