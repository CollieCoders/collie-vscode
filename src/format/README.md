# Collie Formatter Scaffolding

Stage 0 checkpoints for Priority 2 are complete:

- Parser source references (from `collie-core-code.zip` on the Desktop) have been identified for vendoring later:
  - `packages/compiler/src/ast.ts`
  - `packages/compiler/src/parser.ts`
  - `packages/compiler/src/diagnostics.ts` (parser dependency)
- The shipping VS Code extension (see `package.json`) already contributes the `collie` language id with `.collie` extensions, so no manifest changes are required for formatter hookup.
- Folder layout for the formatter has been created:
  - `src/format/parser/` for the vendored AST + parser
  - `src/format/printer/` for the forthcoming printer implementation

Future formatter work can now proceed without re-checking these prerequisites.
