import type {
  Uri} from 'vscode';
import {
  Position,
  Range,
  RelativePattern,
  workspace,
  type WorkspaceFolder
} from 'vscode';
import * as path from 'path';
import type { Logger } from '../../logger';

export interface CssClassDefinition {
  uri: Uri;
  range: Range;
}

const CSS_INCLUDE_GLOB = '**/*.{css,scss,sass,less}';
const CSS_EXCLUDE_GLOB = '**/{node_modules,dist,build}/**';
const CSS_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);
const EXCLUDED_SEGMENTS = new Set(['node_modules', 'dist', 'build']);

const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_FILES = 2000;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const CLASS_TOKEN_PATTERN = /\.([A-Za-z_][\w-]*)/g;

export function getCssIncludeGlob(): string {
  return CSS_INCLUDE_GLOB;
}

export function isSupportedCssFile(fsPath: string): boolean {
  return CSS_EXTENSIONS.has(path.extname(fsPath).toLowerCase());
}

export function isExcludedCssPath(fsPath: string): boolean {
  const segments = fsPath.split(path.sep);
  return segments.some(segment => EXCLUDED_SEGMENTS.has(segment));
}

function getLineOffsets(text: string): number[] {
  const offsets: number[] = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function positionAt(offset: number, lineOffsets: number[]): Position {
  let low = 0;
  let high = lineOffsets.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (lineOffsets[mid] > offset) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  const line = Math.max(0, low - 1);
  return new Position(line, offset - lineOffsets[line]);
}

function extractClassTokens(text: string): { name: string; start: number; length: number }[] {
  const matches: { name: string; start: number; length: number }[] = [];
  CLASS_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLASS_TOKEN_PATTERN.exec(text)) !== null) {
    matches.push({
      name: match[1],
      start: match.index,
      length: match[0].length
    });
  }
  return matches;
}

interface IndexResult {
  indexed: boolean;
  limitReached: boolean;
}

export class CssClassIndex {
  private readonly classDefinitions = new Map<string, CssClassDefinition[]>();
  private readonly fileClassNames = new Map<string, Set<string>>();
  private readonly fileSizes = new Map<string, number>();
  private totalFiles = 0;
  private totalBytes = 0;
  private limitWarningEmitted = false;

  constructor(private readonly workspaceFolder: WorkspaceFolder, private readonly logger: Logger) {}

  async buildIndex(): Promise<void> {
    this.clear();
    const start = Date.now();

    const include = new RelativePattern(this.workspaceFolder, CSS_INCLUDE_GLOB);
    const exclude = new RelativePattern(this.workspaceFolder, CSS_EXCLUDE_GLOB);
    const files = await workspace.findFiles(include, exclude);

    for (const uri of files) {
      const result = await this.indexFile(uri);
      if (result.limitReached) {
        break;
      }
    }

    const elapsed = Date.now() - start;
    this.logger.info(
      `CSS class index built for ${this.workspaceFolder.name} (${this.totalFiles} files, ${this.classDefinitions.size} classes) in ${elapsed}ms.`
    );
  }

  clear(): void {
    this.classDefinitions.clear();
    this.fileClassNames.clear();
    this.fileSizes.clear();
    this.totalFiles = 0;
    this.totalBytes = 0;
    this.limitWarningEmitted = false;
  }

  hasClass(className: string): boolean {
    return this.classDefinitions.has(className);
  }

  getDefinitions(className: string): CssClassDefinition[] {
    return this.classDefinitions.get(className) ?? [];
  }

  removeFile(uri: Uri): void {
    const key = uri.toString();
    const classNames = this.fileClassNames.get(key);
    if (classNames) {
      for (const className of classNames) {
        const definitions = this.classDefinitions.get(className);
        if (!definitions) {
          continue;
        }
        const filtered = definitions.filter(def => def.uri.toString() !== key);
        if (filtered.length > 0) {
          this.classDefinitions.set(className, filtered);
        } else {
          this.classDefinitions.delete(className);
        }
      }
      this.fileClassNames.delete(key);
    }

    const size = this.fileSizes.get(key);
    if (size !== undefined) {
      this.totalFiles = Math.max(0, this.totalFiles - 1);
      this.totalBytes = Math.max(0, this.totalBytes - size);
      this.fileSizes.delete(key);
    }
  }

  async indexFile(uri: Uri): Promise<IndexResult> {
    if (uri.scheme !== 'file') {
      return { indexed: false, limitReached: false };
    }

    if (!isSupportedCssFile(uri.fsPath) || isExcludedCssPath(uri.fsPath)) {
      return { indexed: false, limitReached: false };
    }

    this.removeFile(uri);

    let statSize = 0;
    try {
      const stat = await workspace.fs.stat(uri);
      statSize = stat.size;
    } catch {
      return { indexed: false, limitReached: false };
    }

    if (statSize > MAX_FILE_BYTES) {
      if (!this.limitWarningEmitted) {
        this.logger.info(
          `Skipping CSS indexing for large files (> ${MAX_FILE_BYTES} bytes).`
        );
        this.limitWarningEmitted = true;
      }
      return { indexed: false, limitReached: false };
    }

    if (this.totalFiles + 1 > MAX_TOTAL_FILES || this.totalBytes + statSize > MAX_TOTAL_BYTES) {
      if (!this.limitWarningEmitted) {
        this.logger.info(
          `Skipping CSS indexing after hitting limits (${MAX_TOTAL_FILES} files / ${MAX_TOTAL_BYTES} bytes).`
        );
        this.limitWarningEmitted = true;
      }
      return { indexed: false, limitReached: true };
    }

    let text = '';
    try {
      const contents = await workspace.fs.readFile(uri);
      text = Buffer.from(contents).toString('utf8');
    } catch (error) {
      this.logger.warn(`Failed to read CSS file: ${uri.fsPath}`, error);
      return { indexed: false, limitReached: false };
    }

    const classTokens = extractClassTokens(text);
    const lineOffsets = getLineOffsets(text);
    const classNames = new Set<string>();

    for (const token of classTokens) {
      const start = token.start;
      const end = token.start + token.length;
      const range = new Range(positionAt(start, lineOffsets), positionAt(end, lineOffsets));
      const definition: CssClassDefinition = { uri, range };

      const existing = this.classDefinitions.get(token.name);
      if (existing) {
        existing.push(definition);
      } else {
        this.classDefinitions.set(token.name, [definition]);
      }

      classNames.add(token.name);
    }

    this.fileClassNames.set(uri.toString(), classNames);
    this.fileSizes.set(uri.toString(), statSize);
    this.totalFiles += 1;
    this.totalBytes += statSize;

    return { indexed: true, limitReached: false };
  }
}
