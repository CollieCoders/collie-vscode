# Collie VS Code Extension — Priority 4 Plan
File: `priority-4-plan.md`

## Context & Problem
After Priority 3, Collie has “single-file intelligence” (diagnostics, hovers, symbols, basic completions, and local go-to-definition). The biggest remaining gap is that Collie still feels **file-local** and sometimes “dumb” across the project.

Priority 4 makes Collie **project-aware** by adding a lightweight **workspace index** and cross-file features:
- Accurate go-to-definition for components across folders
- Find all references for components
- Workspace symbol search / quick navigation
- Better completions based on real project structure
- Rename (component-level) with safe boundaries

This is *not* a full language server yet, but it’s the first step toward one.

---

## ✅ Priority 4 Goals
### What we will deliver
1. **Workspace Indexer**
   - Incrementally indexes `.collie` files (and optionally `.tsx/.jsx`) in the workspace
   - Tracks component exports/definitions and references/usages
2. **Accurate Go to Definition**
   - Component usage → actual file/position
3. **Find All References**
   - Component usage occurrences across the workspace
4. **Workspace Symbols**
   - Searchable symbols for `.collie` files (components / major blocks)
5. **Rename Symbol (Scoped)**
   - Rename a component tag across `.collie` files (and optionally imports in `.tsx`) with safe rules

### Non-goals for Priority 4
- No full type-checking or expression evaluation
- No exhaustive React build-system integration
- No framework-specific attribute/property IntelliSense
- No full LSP protocol implementation (unless we decide later)

---

## 🚩 Guardrails
### Do NOT write tests
Do not add automated tests unless explicitly requested later.

### Performance constraints
- Indexing must be incremental and cancellable.
- Do not block the extension host on initial indexing.
- Prefer debounced updates and cached results.
- Always respect `CancellationToken` in providers.

### Safety constraints (critical)
- Rename must never touch:
  - string literals
  - comments
  - text after `|` (standalone text)
  - code inside `{{ ... }}` unless explicitly enabled later

---

## Architecture Overview
Priority 4 introduces a single new subsystem:

### `WorkspaceIndex`
A long-lived in-memory index keyed by document URIs:
- Parsed AST cache (from Priority 2)
- Extracted symbols (component definitions, tag usages)
- Reverse reference map (component → locations)

**Key principle:** parse once, reuse everywhere.

Suggested structure:
- `src/workspace/`
  - `index.ts` (WorkspaceIndex implementation)
  - `scanner.ts` (initial scan + watchers)
  - `extract.ts` (AST → symbols)
  - `types.ts` (shared types)
  - `cache.ts` (doc parse cache)

---

## Stage 0 — Define Symbol Model & Scoping Rules
### Objective
Define what “symbols” mean for Collie and how we identify them.

### Symbol categories (MVP)
1. **Component Definition**
   - `.collie` file “root component” symbol:
     - Use filename as component name by default (e.g., `Welcome.collie` → `Welcome`)
     - If the language supports an explicit `component` directive (now or future), prefer that.
2. **Component Usage**
   - Any element/tag token that is PascalCase (e.g., `MyButton`) is considered a component usage.
3. **Local Block Symbols**
   - `props`
   - conditionals (`@if`, `@elseIf`, `@else`)

### Implementation Steps
1. Create `src/workspace/types.ts` defining:
   - `ComponentName`
   - `Location { uri, range }`
   - `ComponentDef { name, location, uri }`
   - `ComponentRef { name, location, uri }`
2. Decide naming normalization:
   - `Welcome.collie` → `Welcome`
   - Strip extensions and common separators (`-`, `_`) only if you can do so safely.
   - Prefer strict: only PascalCase filenames become component names.

### User Acceptance Checklist
- Types compile and are imported cleanly by future stages.

---

## Stage 1 — Build the Workspace Scanner (Initial Scan + Watchers)
### Objective
Discover relevant files and keep the index updated as files change.

### Implementation Steps
1. Add `src/workspace/scanner.ts`:
   - On activation:
     - `vscode.workspace.findFiles('**/*.collie', '**/node_modules/**')`
   - (Optional) include `**/*.{tsx,jsx}` later for rename/import updates.
2. Add file system watchers:
   - `workspace.createFileSystemWatcher('**/*.collie')`
   - Handle:
     - create → index new file
     - change → reindex file (debounced)
     - delete → remove from index
3. Add an “index ready” state:
   - `index.isReady` after initial scan completes
   - Do not block activation; index in background.

### User Pre-Flight Checklist
- Ensure the extension activates on `.collie` open.
- Confirm no existing watchers conflict.

### User Acceptance Checklist
- Open VS Code command palette logs show:
  - “Collie indexing started…”
  - “Collie indexing complete (N files)”
- Creating/editing/deleting a `.collie` file updates the index without reload.

---

## Stage 2 — Implement WorkspaceIndex Core (Parse Cache + Symbol Extraction)
### Objective
Centralize parsing + symbol extraction into one reusable service.

### Implementation Steps
1. Add `src/workspace/index.ts`:
   - `upsertDocument(uri, text, version)`
   - `removeDocument(uri)`
   - `getComponentDef(name)`
   - `getComponentRefs(name)`
   - `searchSymbols(query)`
2. Add `src/workspace/cache.ts`:
   - Cache parse results keyed by:
     - uri + document version
3. Add `src/workspace/extract.ts`:
   - `extractComponentDef(uri, ast)`
   - `extractComponentRefs(uri, ast)`
   - `extractDocumentSymbols(uri, ast)`
4. Ensure extraction is cheap:
   - single AST walk per document update
   - store results in maps:
     - `defsByName: Map<ComponentName, ComponentDef>`
     - `refsByName: Map<ComponentName, ComponentRef[]>`
     - `symbolsByUri: Map<Uri, DocumentSymbol[]>`

### User Acceptance Checklist
- Index builds without errors
- Updating a file updates def/ref maps correctly
- No noticeable lag on save

---

## Stage 3 — Upgrade Go to Definition (Workspace-Aware)
### Objective
Make Cmd/Ctrl+Click go-to-definition work across folders for component tags.

### Implementation Steps
1. In the existing `DefinitionProvider`:
   - Identify component name at cursor (PascalCase token)
   - Query `WorkspaceIndex.getComponentDef(name)`
   - Return `Location` if found
2. If not found:
   - fallback to previous heuristic (same-folder scan), but prefer index.

### User Acceptance Checklist
- Works across nested folders
- If a component exists multiple times with same name:
  - show a QuickPick list (or return multiple definitions)

---

## Stage 4 — Find All References
### Objective
Implement `ReferenceProvider` for component tags.

### Implementation Steps
1. Register `ReferenceProvider` for `collie`
2. On request:
   - Determine component name at cursor
   - Return all refs from `WorkspaceIndex.getComponentRefs(name)`
   - Include the definition location optionally (VS Code supports `includeDeclaration`)
3. Ensure results are stable and deduped.

### User Acceptance Checklist
- “Find All References” shows usages across workspace
- It’s fast (instant after indexing)

---

## Stage 5 — Workspace Symbols
### Objective
Support “Go to Symbol in Workspace” for Collie.

### Implementation Steps
1. Register `WorkspaceSymbolProvider`
2. Backed by `WorkspaceIndex.searchSymbols(query)`:
   - Search component defs by name
   - Optionally include major blocks (props/conditionals) labeled with `FileName • props`
3. Use `SymbolInformation` or `WorkspaceSymbol` API depending on VS Code version.

### User Acceptance Checklist
- Typing “Welcome” finds `Welcome.collie`
- Selecting symbol jumps to correct location

---

## Stage 6 — Rename Provider (Scoped & Safe)
### Objective
Rename a component tag safely across `.collie` files (and optionally in `.tsx` later).

### Rename rules (MVP)
- Only rename **PascalCase tag tokens** in `.collie` element lines.
- Do not rename:
  - plain HTML tags
  - anything inside `|` text
  - anything inside `{{ ... }}` expressions
  - comments (if Collie has them)
- If the new name is not PascalCase, reject with a helpful error.

### Implementation Steps
1. Register `RenameProvider` for `collie`
2. On rename:
   - Determine target component name under cursor
   - Validate new name
   - Gather edits:
     - For each `ComponentRef` location, produce a `TextEdit.replace(range, newName)`
     - If cursor is on definition, also rename definition symbol (optional; safe if it’s just filename-based is tricky)
3. Handling filename-based definitions:
   - MVP: **do not rename files automatically**
   - Optionally suggest: “Rename file manually to match component name”

### User Acceptance Checklist
- Rename updates all usages in `.collie` files
- No edits appear in text blocks or expressions
- Renaming to invalid casing is prevented

---

## Stage 7 — Optional: Index `.tsx/.jsx` Imports for Smarter Rename
### Objective
Extend rename to update imports in TSX/JSX (optional, but big UX win).

### Constraints
- Must be conservative; do not attempt full TS AST manipulation in MVP.
- Accept only very obvious patterns:
  - `import Welcome from './Welcome.collie'`
  - `import Welcome from "./Welcome"`
  - `import { Welcome } from ...` (optional)

### Implementation Steps
1. Add optional feature flag:
   - `collie.features.renameImports`
2. For `.tsx/.jsx` files:
   - scan text for import identifiers matching oldName
   - apply rename edits only when pattern is unambiguous

### User Acceptance Checklist
- If enabled, rename updates imports in simple cases
- If ambiguous, it skips rather than breaking code

---

## Stage 8 — Robustness, Telemetry-Free Logging, and UX Polish
### Objective
Make indexing transparent and reliable.

### Implementation Steps
1. Add a status bar item:
   - “Collie: Indexing…” → “Collie: Ready”
2. Add `OutputChannel` logs:
   - index start/end
   - file reindex events (debug-level)
3. Add user command:
   - “Collie: Rebuild Index”
4. Ensure watchers are disposed on deactivation.

### User Acceptance Checklist
- Users understand what the extension is doing
- No noisy logs by default
- Manual rebuild works

---

## Stage 9 — Docs
### Objective
Document project-aware features and limitations.

### Implementation Steps
1. README updates:
   - How indexing works
   - Exclusions (`node_modules`)
   - What rename touches (and what it never touches)
2. Mention feature flags and recommended settings.

### User Acceptance Checklist
- README matches reality
- Users can troubleshoot indexing easily

---

## Recommended Agent Prompt
Use this exact structure when delegating:

“Proceed with Stage X of `priority-4-plan.md`.
Do NOT write tests.
After implementation, manually verify in Extension Development Host:
- indexing runs
- go-to-definition works across folders
- references return quickly
- rename is safe and scoped.”
