import type { Uri } from 'vscode';

export interface CollieWriteResult {
  uri: Uri;
  idLine: number;
  wasCreated: boolean;
}

export interface CollieTemplateMatch {
  id: string;
  idLine: number;
  content: string;
}

export interface CollieTemplateBlock {
  id: string;
  idLine: number;
}
