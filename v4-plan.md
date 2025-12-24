# Collie v4 Targeted Improvement Plan

*For use with the Codex VS Code extension*

This document defines **implementable features and fixes** for the `collie-vscode` repo.

Each item includes:

* **Problem** — what’s wrong or missing
* **Goal** — what we want instead
* **Requirements** — constraints/behavior
* **Implementation Steps** — concrete steps Codex should follow
* **Acceptance Criteria** — what must be true when it’s done

---

## ========================================

## B. FEATURES — VS CODE EXTENSION

## ========================================

---

## **B1 — Use the Real Compiler for Parsing, AST, and Diagnostics**

**Repo:** `collie-vscode` (plus possible small changes in `collie` compiler)

### Problem

The VS Code extension currently implements its own:

* Parser
* AST types
* Diagnostics

The core `collie` compiler has its own parser/AST/diagnostics. This duplication creates **spec drift** risk and doubles maintenance cost.

### Goal

Make the VS Code extension rely on the **real collie compiler** for:

* Parsing
* AST structure
* Diagnostics (error codes and messages)
* Any additional language analysis needed (e.g. for semantic tokens later)

### Requirements

* The `@collie-lang/compiler` package must expose a **browser/bundler-safe** build that can be imported by the extension (no Node-only APIs on import).

* The extension must:

  * Replace its internal parser with compiler calls.
  * Map compiler diagnostics to VS Code `Diagnostic` objects.
  * Reuse compiler AST as the single source of truth for structure.

* Existing behavior (error codes, positions) must remain consistent or intentionally improved.

### Implementation Steps

1. **Prepare compiler for extension use (in `collie` repo)**

   * Ensure `@collie-lang/compiler` (or equivalent) exports:

     * `parseCollie` (or similar entrypoint) returning AST + diagnostics.
     * Types necessary for AST traversal.
   * Ensure there is a build target that:

     * Does not require Node-specific modules at import time.
     * Works as a dependency of the VS Code extension.

2. **Update extension dependencies**

   * Add `@collie-lang/compiler` as a dependency in `collie-vscode`.
   * Reference the appropriate build entrypoint (ESM/CJS depending on extension bundling).

3. **Replace internal parser with compiler parser**

   * Identify the existing parser entrypoints in `collie-vscode`:

     * e.g. `src/format/parser/parseCollie.ts`, AST definitions, and diagnostic logic.
   * Replace those implementations with calls to the compiler:

     * For a given document text, call compiler parse function.
     * Store or pass along the resulting AST and diagnostics.
   * Remove or deprecate duplicated AST and diagnostic code in the extension (keeping only minimal adapter code).

4. **Wire diagnostics provider to compiler diagnostics**

   * In `diagnosticsProvider.ts` (or equivalent), update logic to:

     * Parse with the compiler.
     * Convert compiler diagnostics (spans, codes, messages) to VS Code `Diagnostic` objects.
     * Maintain error codes in diagnostics messages (e.g., `COLLIE101`, etc.).

5. **Expose AST where needed**

   * For features that rely on AST (formatting, semantic tokens, navigation), make sure they:

     * Receive the compiler AST rather than re-parsing or re-tokenizing.
     * If any code paths still expect the old AST shape, adapt them or update them to the compiler’s AST types.

6. **Testing and regression checks**

   * Add or update tests to validate that:

     * Documents that compile successfully via CLI also show no diagnostics in the extension.
     * Documents that fail compilation via CLI show matching diagnostics (codes and spans) in the extension.
   * Compare a few representative error cases manually (syntax errors, unclosed blocks, etc.).

### Acceptance Criteria

* For any collie file, the extension’s diagnostics match the CLI compiler’s diagnostics (same error codes, similar positions).
* The extension no longer maintains an independent parser or diagnostic spec; instead, it calls into the compiler.
* AST consumers in the extension (formatter, semantic tokens, navigation) receive compiler AST data.
* The extension remains stable under typical usage (no crashes when loading the compiler).

---

## **B2 — Workspace Alias Index for Completions and Navigation**

**Repo:** `collie-vscode`

### Problem

Class alias features (`classes` block, alias references, etc.) are currently resolved in an ad-hoc or per-file manner. Completions and navigation:

* May only see aliases defined in the current file
* Or rely on scanning other files on demand (potentially slow)

This doesn’t scale well and doesn’t give a good workspace-wide experience.

### Goal

Introduce a **workspace-wide alias index** that:

* Tracks all alias definitions across `.collie` files.
* Powers:

  * completions
  * go-to-definition
  * potentially references
* Updates incrementally on file changes.

### Requirements

* Maintain an in-memory index of:

  * `fileUri` → list of alias definitions (`name`, classes, position).
* File watching:

  * index is initialized on activation by scanning workspace `.collie` files.
  * index is updated on:

    * document open/change/save
    * file create/delete/rename events
* Completions:

  * Use the index only (no per-request disk reads).
* Navigation:

  * "Go to Alias Definition" uses the index to jump to definition location.

### Implementation Steps

1. **Create alias index service**

   * Add a module, e.g. `aliasIndex.ts`, that:

     * Defines `AliasDefinition` type:

       ```ts
       interface AliasDefinition {
         name: string;
         uri: vscode.Uri;
         range: vscode.Range;
         classes: string[]; // optional but useful
       }
       ```
     * Exposes functions:

       * `initialize(workspaceFolders)` — initial scan.
       * `updateForDocument(document)` — update aliases from an in-memory document.
       * `removeForUri(uri)` — remove aliases from index when file deleted.
       * `findDefinitionsByName(name)` — return matching definitions.

2. **Initialize index on activation**

   * On extension activation:

     * Enumerate all `.collie` files in workspace.
     * For each, parse with the compiler (per B1) and extract alias definitions (from `classes` blocks).
     * Populate index.

3. **Incremental updates**

   * Hook into:

     * `workspace.onDidChangeTextDocument` for `.collie` documents:

       * Reparse and update alias definitions for that URI.
     * `workspace.onDidCreateFiles` / `onDidDeleteFiles` / `onDidRenameFiles`:

       * Update or remove alias entries accordingly.
   * Ensure the index update logic is fast and resilient to errors.

4. **Use index in completion provider**

   * Update the completion provider responsible for `$alias` completions to:

     * Query `aliasIndex.findDefinitionsByName` or similar.
     * Provide completion items for all matching aliases across the workspace.
     * Include `detail` or `documentation` fields showing which file the alias is defined in.

5. **Use index in go-to-definition / navigation**

   * Add or update a definition provider for alias references:

     * When cursor is on an alias reference (e.g. `$primary` or similar syntax), look up `aliasIndex` for `primary`.
     * Return the location(s) for definitions as `Location` objects.

6. **Add “Rebuild Alias Index” command**

   * Implement a command:

     * `"Collie: Rebuild Alias Index"`
   * When invoked:

     * Discards existing index.
     * Re-runs the full scan.

### Acceptance Criteria

* Alias completions suggest aliases defined anywhere in the workspace, not just the current file.
* “Go to Definition” on an alias reference jumps to the correct `classes` definition.
* Adding/removing aliases in any collie file updates completions and navigation without restarting VS Code.
* Alias lookup does not cause noticeable lag in large workspaces.

---

## **B3 — TypeScript Integration: Go-to-Definition, Rename, References via Generated TSX**

**Repo:** `collie-vscode`

### Problem

Currently, collie navigation is mostly confined to collie files themselves. There is no deep integration with TypeScript:

* You can’t go from a collie component usage to its TS/TSX definition.
* You can’t rename props or components in a way that propagates across collie and TSX.

### Goal

Add a **TypeScript-aware bridge** so that:

* “Go to Definition” on a component/tag in collie jumps to the TS/TSX definition.
* (Optional but ideal) Rename and references can leverage TypeScript’s language service using the compiled TSX.

### Requirements

* Map collie source locations to compiled TSX positions (offset mapping).
* Use VS Code’s built-in commands:

  * `vscode.executeDefinitionProvider`
  * `vscode.executeRenameProvider`
  * `vscode.executeReferenceProvider` (if implemented)
* Translate results back from TSX positions to collie positions where meaningful.

### Implementation Steps

1. **Establish TSX virtual document mapping**

   * Decide on a virtual document scheme, e.g. `collie-generated://<originalUri>`.
   * Implement a virtual `TextDocumentContentProvider` that:

     * For a given collie URI, calls the compiler to generate TSX.
     * Stores both:

       * TSX source text
       * Mapping from collie spans → TSX spans (the compiler may need to expose or compute this).
   * Ensure that the TSX document is registered with the `typescript` language service.

2. **Generate and manage TSX on demand**

   * On “go to definition”, “rename”, or “references” operations coming from a collie document:

     * Ensure TSX virtual document exists (or generate it on the fly).
     * Use the collie→TSX mapping to compute the corresponding TSX position.

3. **Delegate to TS language service**

   * Call VS Code command(s) such as:

     * `vscode.commands.executeCommand('vscode.executeDefinitionProvider', tsxUri, tsxPosition)`
   * Receive TSX-side `Location[]`.

4. **Translate TSX locations back to collie where applicable**

   * For locations that correspond to code generated from collie:

     * Use the mapping to try to map TSX positions back to original collie positions.
   * For locations that refer to external TS files (not generated from collie):

     * Return those TS `Location`s directly (normal behavior: jump to component definition in `.tsx` file).

5. **Hook into go-to-definition provider for collie files**

   * For collie files:

     * When user invokes “Go to Definition” on a component or symbol:

       * Determine if it should be resolved via TypeScript.
       * Use the TS bridge described above.
     * If a symbol is purely collie-local (e.g. a `classes` alias, already handled by B2), keep handling that separately.

6. **Optionally hook rename and references**

   * Implement rename provider for collie documents:

     * On rename at a collie symbol:

       * Map to TSX position.
       * Use `vscode.executeRenameProvider` with TSX URI/position.
       * Translate text edits back to collie and TS files as appropriate.
   * Similar approach for references (`executeReferenceProvider`).

7. **Testing**

   * Add tests where:

     * `MyComponent` is defined in `MyComponent.tsx`.
     * `MyComponent` is used in `MyComponent.collie`.
     * “Go to Definition” on `MyComponent` in collie jumps to `MyComponent.tsx`.
     * (If rename implemented) renaming `MyComponent` from collie updates the TSX filename or symbol as appropriate.

### Acceptance Criteria

* From a collie file, “Go to Definition” on a component name jumps to the correct TS/TSX definition.
* Integration uses the TypeScript language service and respects its behavior (e.g. definitions, overloads, etc.).
* For symbols that exist only in TS/TSX, results behave as in a normal TSX project.
* If rename/references are implemented, they propagate changes across collie and TSX consistently.

---

## **B5 — Inline “Show Compiled JSX” Preview in VS Code**

**Repo:** `collie-vscode`

### Problem

Users have no built-in way to see the compiled JSX/TSX that collie generates. Debugging or understanding codegen requires running external tools or guessing.

### Goal

Provide a **read-only JSX/TSX preview** in VS Code:

* Command: “Collie: Show Compiled JSX for This File”
* Opens a virtual document with the compiled TSX.
* Uses TSX syntax highlighting.
* Updates when the source collie file changes (on save).

### Requirements

* New VS Code command to trigger the preview.
* Virtual document content is generated via the actual compiler (same as CLI).
* Preview is read-only.
* Handles all collie features (classes, directives, guards, etc.).

### Implementation Steps

1. **Virtual document setup**

   * Define a URI scheme, e.g. `collie-jsx://<originalUri>`.
   * Implement a `TextDocumentContentProvider`:

     * Given a collie URI, call the compiler to obtain TSX.
     * Return TSX string as document content.

2. **Command implementation**

   * Register a command, e.g. `"collie.showCompiledJsx"`.
   * When executed:

     * Determine the active editor’s document URI (must be `.collie`).
     * Construct the corresponding virtual TSX URI (`collie-jsx://...`).
     * Use `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument` to open preview.
     * Set the language of the virtual document to `typescriptreact` or `javascriptreact` for proper highlighting.

3. **Update behavior on save**

   * Listen for `onDidSaveTextDocument` events for collie documents.
   * When a corresponding TSX preview is open:

     * Re-trigger the compiler.
     * Update the virtual document content via the `TextDocumentContentProvider` (fire `onDidChange` event).

4. **Error handling**

   * If compilation fails:

     * Show a brief message in the preview, e.g. `/* Collie compilation failed: <message> */`.
     * Do not crash or leave the preview in an inconsistent state.

5. **User experience**

   * Ensure the command is discoverable:

     * Add to Command Palette.
     * Optionally add a status bar item or context menu entry.

### Acceptance Criteria

* From a `.collie` file, running “Collie: Show Compiled JSX for This File” opens a new editor showing TSX.
* The TSX is exactly what the compiler would generate (or very close, depending on setup).
* Saving the collie file re-generates the TSX preview.
* Compilation errors are displayed clearly in the preview instead of causing crashes.

---


## ========================================

## D. ISSUES — VS CODE EXTENSION

## ========================================

---

## **D2 — Replace Heuristic Semantic Tokens With AST-Driven Tokens**

**Repo:** `collie-vscode` (depends on B1)

### Problem

The semantic tokens provider currently tokenizes collie files via **line-based heuristics**:

* Tracks state like `inBlockComment`, `propsIndent`, `classesIndent`.
* Looks for keywords and patterns using text-level matching.

This approach:

* Is fragile in the face of syntax changes.
* Can mis-tokenize edge cases.
* Duplicates parsing logic already present in the compiler.

### Goal

Use the **compiler AST** (from B1) to drive semantic token generation:

* Map AST node kinds directly to token types and modifiers.
* Avoid text scanning/regex.
* Achieve stable, accurate syntax highlighting.

### Requirements

* Semantic tokens provider must rely on:

  * Compiler AST for structure.
  * Compiler diagnostics for error states (optional).
* Map node categories to token types, for example:

  * Tags/elements → `function` or `class` or `type` (depending on your chosen semantic categories).
  * Props/attributes → `property`.
  * `classes` block identifier → custom category or `namespace`.
  * Alias references → `variable` or `enumMember`.
  * Control flow keywords (`@if`, `@for`, etc.) → `keyword`.
* Token positions must align with actual text ranges and be stable.

### Implementation Steps

1. **Depend on compiler AST (B1)**

   * Ensure the extension already uses the compiler to parse collie files and get AST nodes.
   * The semantic tokens provider should receive or fetch this AST.

2. **Design AST → token type mapping**

   * Define a mapping from collie AST node kinds to VS Code token types and modifiers.
   * Example mapping (adjust to taste/consistency):

     * Tag names (HTML-like) → `type` or `function`
     * Component names (PascalCase) → `class`
     * Props/attributes names → `property`
     * `classes` block name → `namespace`
     * Alias identifiers → `variable`
     * Comments → `comment`
     * Control directives → `keyword`

3. **Rewrite semantic tokens provider**

   * In `semanticTokens/tokenize.ts` (or equivalent):

     * Remove line-scanning text logic.
     * Instead, traverse the AST (e.g. depth-first).
   * For each node:

     * Compute token ranges from node spans (converted to line/character via document offsets).
     * Push tokens filling `SemanticTokensBuilder`.

4. **Handle errors and incomplete syntax**

   * If AST contains error nodes or incomplete constructs:

     * Either skip them gracefully or use fallback tokenization for those regions.
     * Ensure that errors in one part of the file don’t break tokenization for the rest.

5. **Testing**

   * Create example collie files that:

     * Use `props`, `classes`, `@if`, `@for`, nested elements, etc.
     * Include alias definitions and references.
     * Include comments and mixed indentation.
   * Add tests that:

     * Request semantic tokens.
     * Verify tokens roughly match expectations (types at least; exact ranges if feasible).

### Acceptance Criteria

* Semantic tokens remain correct and stable across all valid collie syntax constructs.
* Adding new language features to the compiler only requires updating AST→token mapping, not writing new regex logic.
* No noticeable regressions in highlighting performance or correctness.
* Heuristic line-scanning logic is removed or minimized.

---

## **D3 — Improve Completion Performance by Using the Alias Index Only**

**Repo:** `collie-vscode` (depends on B2)

### Problem

Currently, the completion provider may re-scan documents or hit the file system on each completion request to discover aliases. This:

* Does not scale to large workspaces.
* Causes slow or laggy completion behavior.
* Duplicates logic that is better handled via a centralized index.

### Goal

Make completions rely entirely on the **workspace alias index** (from B2):

* No disk reads or rescans during a completion request.
* All alias discovery happens in response to file changes, not on demand.

### Requirements

* Completion provider must use only:

  * The in-memory alias index.
  * Context from the current document (caret position, etc.).
* All alias-related scanning should happen:

  * On initial index build
  * On document open/save/change
  * On file create/delete/rename

### Implementation Steps

1. **Integrate completion provider with alias index**

   * Update the completion provider responsible for `$alias` (or equivalent) completions so that:

     * It queries the alias index service created in B2.
     * It no longer reads files from disk or rescans the entire workspace on each request.

2. **Remove per-request scanning**

   * Find and remove any logic that:

     * Enumerates `.collie` files at completion time.
     * Reads files from disk during completion.
     * Parses full documents that aren’t already in memory.
   * Ensure that alias discovery is fully delegated to B2’s index.

3. **Optimize local context usage**

   * For the currently open document:

     * You may still use its in-memory text/AST (no disk access) to:

       * Determine the completion context.
       * Prefer local aliases over remote ones if necessary (but all definitions come from the index).

4. **Add basic performance logging (optional, only in dev builds)**

   * Optionally log completion request duration when a debug config is enabled.
   * This helps detect regressions in completion performance.

5. **Testing**

   * Create a workspace with multiple `.collie` files and many aliases.
   * Assert (in tests or manual profiling) that:

     * Completions are more or less constant-time, independent of the number of `.collie` files.
     * No file system reads occur during completion (only at index build/update time).

### Acceptance Criteria

* Alias completions are provided using only the alias index (no ad-hoc rescans).
* Completion remains fast even with a large number of `.collie` files.
* Removing or adding alias definitions in any file is reflected in completion suggestions after save/change, without reloading the extension.
* All direct file I/O inside the completion provider has been removed or minimized to initial setup/indexing.
