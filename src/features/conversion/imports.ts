import * as ts from 'typescript';
import { EndOfLine, TextDocument, WorkspaceEdit } from 'vscode';

const COLLIE_MODULE = '@collie-lang/react';

export function ensureCollieImport(
  document: TextDocument,
  sourceFile: ts.SourceFile,
  edit: WorkspaceEdit
): boolean {
  const sourceText = document.getText();
  const eol = document.eol === EndOfLine.CRLF ? '\r\n' : '\n';

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text !== COLLIE_MODULE) {
      continue;
    }

    const importClause = statement.importClause;
    if (importClause?.name?.text === 'Collie') {
      return false;
    }

    const namedBindings = importClause?.namedBindings;
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      if (hasCollieNamedImport(namedBindings)) {
        return false;
      }
      return insertNamedImport(document, sourceFile, edit, namedBindings, sourceText);
    }

    if (importClause?.name && !namedBindings) {
      edit.insert(document.uri, document.positionAt(importClause.name.end), ', { Collie }');
      return true;
    }

    const insertText = buildImportInsertionText(
      sourceText,
      statement.end,
      eol,
      `import { Collie } from '${COLLIE_MODULE}';`
    );
    edit.insert(document.uri, document.positionAt(statement.end), insertText);
    return true;
  }

  const insertion = findImportInsertion(sourceFile);
  const insertText = buildImportInsertionText(
    sourceText,
    insertion.offset,
    eol,
    `import { Collie } from '${COLLIE_MODULE}';`
  );
  edit.insert(document.uri, document.positionAt(insertion.offset), insertText);
  return true;
}

function hasCollieNamedImport(namedBindings: ts.NamedImports): boolean {
  return namedBindings.elements.some(element => {
    if (element.name.text === 'Collie') {
      return true;
    }
    const propertyName = element.propertyName;
    return !!propertyName && ts.isIdentifier(propertyName) && propertyName.text === 'Collie';
  });
}

function insertNamedImport(
  document: TextDocument,
  sourceFile: ts.SourceFile,
  edit: WorkspaceEdit,
  namedBindings: ts.NamedImports,
  sourceText: string
): boolean {
  const namedStart = namedBindings.getStart(sourceFile);
  const namedEnd = namedBindings.getEnd();
  const namedText = sourceText.slice(namedStart, namedEnd);
  const closeIndex = namedText.lastIndexOf('}');
  if (closeIndex < 0) {
    return false;
  }

  const insertOffset = namedStart + closeIndex;
  const insertText = namedBindings.elements.length > 0 ? ', Collie' : 'Collie';
  edit.insert(document.uri, document.positionAt(insertOffset), insertText);
  return true;
}

function isDirectiveStatement(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement)) {
    return false;
  }
  const expr = statement.expression;
  return ts.isStringLiteralLike(expr);
}

function findImportInsertion(sourceFile: ts.SourceFile): { offset: number } {
  const statements = sourceFile.statements;
  let index = 0;
  let directiveEnd = 0;

  while (index < statements.length && isDirectiveStatement(statements[index])) {
    directiveEnd = statements[index].end;
    index += 1;
  }

  let lastImportEnd = -1;
  for (; index < statements.length; index += 1) {
    const statement = statements[index];
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      lastImportEnd = statement.end;
      continue;
    }
    break;
  }

  if (lastImportEnd >= 0) {
    return { offset: lastImportEnd };
  }

  return { offset: directiveEnd };
}

function buildImportInsertionText(
  sourceText: string,
  offset: number,
  eol: string,
  importStatement: string
): string {
  const prevChar = offset > 0 ? sourceText[offset - 1] : '';
  const nextChar = offset < sourceText.length ? sourceText[offset] : '';
  const needsPrefix = offset > 0 && !isLineBreakChar(prevChar);
  const needsSuffix = offset >= sourceText.length || !isLineBreakChar(nextChar);
  return `${needsPrefix ? eol : ''}${importStatement}${needsSuffix ? eol : ''}`;
}

function isLineBreakChar(char: string): boolean {
  return char === '\n' || char === '\r';
}
