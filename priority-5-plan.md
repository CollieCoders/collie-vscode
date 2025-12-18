# Collie VS Code Extension — Priority 5 Plan
File: `priority-5-plan.md`

## Context & Problem
After Priority 3 (in-file diagnostics) and Priority 4 (JSX/TSX selection → Collie generation), the next “real language” expectation is **cross-file correctness**.

The concrete pain point:

> A React/TSX file renders a Collie component and passes props (`<Welcome foo={...} />`), but the `.collie` file does not declare `foo` in its `props` block.

This is the first step toward “type-aware Collie,” and it’s where architecture choices matter. We’ll implement a **conservative, best-effort** cross-file diagnostic that catches obvious mistakes without turning the extension into a full-blown TypeScript language server.

---

## ✅ Priority 5 Goals
### What we will deliver (MVP)
1. **Cross-file props diagnostics** for TS/TSX (and optionally JS/JSX):
   - Detect imports of `.collie` components
   - Detect JSX usages of those components
   - Compare JSX attribute names to Collie `props` declarations
   - Report missing/unknown props as VS Code Problems in the TSX file (and optionally also in the `.collie` file)
2. **Fast, incremental indexing**
   - Re-check only affected files on save/change
3. **Configurable + safe-by-default**
   - Feature flag and severity controls
   - Escape hatches for spread props and intentionally “open” components

### Non-goals
- No TypeScript type-checking (we only validate prop *names*, not types)
- No evaluation of expressions or inference of spreads
- No framework mode switches (React only in this priority)
- No deep module resolution for every edge case (we’ll stage that)

---

## 🚩 Guardrails
### Do NOT write tests
Do not add automated tests unless explicitly requested later.

### Safety / False positive minimization
- Prefer **under-reporting** over breaking users’ flow with noisy diagnostics.
- Any case that is ambiguous should be ignored or downgraded (e.g., spread props).

### Performance
- Indexing must not block the extension host.
- Use caching, debouncing, and `CancellationToken` everywhere possible.

---

## Recommended Approach (MVP-first, not over-engineered)
Implement a **project-level indexer** in the extension:

1. **Collie Props Index**
   - Parse `.collie` files (using the parser you vendored for formatting)
   - Extract declared props: `Set<string>` per Collie file
2. **TSX Usage Scanner**
   - Parse TS/TSX files using the TypeScript compiler API (`typescript` package)
   - Find imports that reference `.collie` files
   - Find JSX elements that use those imported identifiers
   - Compare JSX attributes to declared Collie props

This yields a strong UX improvement without requiring TS language service integration on day 1.

---

## Stage 0 — Baseline, Settings, and Feature Flags
### Objective
Add config controls and the scaffolding to safely introduce cross-file diagnostics.

### Implementation Steps
1. Add new configuration in `package.json`:
   - `collie.features.crossFilePropsDiagnostics` (boolean, default `false` initially)
   - `collie.crossFilePropsDiagnostics.severity` (`warning` | `error`, default `warning`)
   - `collie.crossFilePropsDiagnostics.ignoreUnknownWhenSpreadPresent` (boolean, default `true`)
   - `collie.crossFilePropsDiagnostics.allowAdditionalProps` (array of globs or component names; default empty)
2. Add a dedicated diagnostics collection:
   - `DiagnosticCollection('collie-crossfile')`
3. Add a minimal logging hook (OutputChannel):
   - “Cross-file props diagnostics enabled/disabled”
   - “Indexing started/complete”

### User Pre-Flight Checklist
- Ensure the extension builds and runs in Extension Development Host.
- Confirm `typescript` is available as a dependency (add it if not).

### User Acceptance Checklist
- Settings appear in VS Code.
- Feature defaults to OFF (no behavior change yet).

---

## Stage 1 — Build the Collie Props Index
### Objective
Extract declared props from every `.collie` file in the workspace.

### Extraction Rules (MVP)
- If a `.collie` file has a `props` block:
  - collect each prop name (`name`, `name?`)
- Ignore prop types for now (we only validate names)
- Component name mapping:
  - Use filename stem as component name (e.g., `Welcome.collie` → `Welcome`)
  - Also index by URI so TSX imports can resolve directly to a file

### Implementation Steps
1. Add `src/crossfile/propsIndex.ts`:
   - `indexCollieFile(uri, text, version) -> { props: Set<string> }`
   - `removeCollieFile(uri)`
   - `getPropsByUri(uri) -> Set<string> | undefined`
2. Implement `.collie` discovery:
   - `workspace.findFiles('**/*.collie', '**/node_modules/**')`
3. Add file watchers for `.collie`:
   - create/change/delete updates the index
4. Store:
   - `propsByUri: Map<string, Set<string>>`
   - `componentNameByUri: Map<string, string>` (optional convenience)

### User Acceptance Checklist
- On activation, logs show `.collie` files indexed.
- Editing a `.collie` `props` block updates the props set.

---

## Stage 2 — Parse TS/TSX and Resolve `.collie` Imports
### Objective
For each TS/TSX document, find identifiers that refer to `.collie` files.

### Implementation Details
Use the TypeScript compiler API:
- `ts.createSourceFile(fileName, text, ScriptTarget.Latest, true, ScriptKind.TSX/TS)`
- Walk import declarations:
  - `import Welcome from './Welcome.collie'`
  - `import { Welcome } from './Welcome.collie'` (optional)
  - `import * as X from './Welcome.collie'` (ignore for MVP)

Resolve import path → absolute URI:
- Only support **relative imports** first (`./`, `../`)
- Add extension inference if needed:
  - if import ends with `.collie`, resolve directly
  - if it lacks extension but matches an existing `.collie`, support later (Stage 6)

### Implementation Steps
1. Add `src/crossfile/tsxImports.ts`:
   - `extractCollieImports(sourceFile, currentFileUri) -> Array<{ localName, collieUri }>`
2. Add robust path resolution helper:
   - `resolveRelativeImportToUri(currentFileUri, specifierText)`

### User Acceptance Checklist
- For a TSX file importing `./Welcome.collie`, the scanner yields:
  - `localName = Welcome`
  - `collieUri = file:///.../Welcome.collie`

---

## Stage 3 — Detect JSX Usages and Compare Props
### Objective
Find `<Welcome ... />` and validate attribute names vs declared props.

### JSX Validation Rules (MVP)
- Only validate when the tag name matches an imported localName
- Only validate “simple” attributes:
  - `foo`
  - `foo={expr}`
  - `foo="string"`
- Handling spreads:
  - If `...something` is present and `ignoreUnknownWhenSpreadPresent=true`, do **not** report unknown props (to avoid noise).
- Ignore:
  - `ref`, `key` (React reserved)
  - `children` (allow by default, unless you want strict mode)
- If Collie has *no* `props` block:
  - Option A (conservative): do not report anything
  - Option B (strict-ish): report all props as unknown
  - **Recommendation:** Option A for MVP, with a setting to enable Option B later.

### Implementation Steps
1. Add `src/crossfile/tsxUsage.ts`:
   - `extractJsxUsagesForImportedComponents(sourceFile, imports) -> Array<{ componentName, attrs: string[], rangesByAttr }>`
2. Add `src/crossfile/compare.ts`:
   - `diffProps(passedAttrs, declaredProps, options) -> diagnostics`
3. Emit diagnostics in the TSX file:
   - range should highlight the attribute name token
   - message example:
     - `Unknown prop "foo" passed to Collie component "Welcome" (not declared in Welcome.collie props).`

### User Acceptance Checklist
- In TSX, `<Welcome foo={1} />` squiggles `foo` if `foo` is not declared.
- Adding `foo` to the Collie `props` block removes the squiggle after reindex.

---

## Stage 4 — Wire the Cross-File Diagnostic Pipeline
### Objective
Run the cross-file check automatically and keep results up-to-date.

### Trigger Strategy (MVP)
- Run on **document save** for TS/TSX to keep it cheap and predictable.
- Also run on:
  - `.collie` save → re-check TSX files that import that `.collie` (reverse map)

### Implementation Steps
1. Add `src/crossfile/engine.ts`:
   - orchestrates propsIndex + TSX scanning + diagnostics publishing
2. Maintain a reverse dependency map:
   - `tsxFilesByCollieUri: Map<collieUri, Set<tsxUri>>`
3. Events:
   - `workspace.onDidSaveTextDocument`
   - `watcher.onDidChange` for `.collie` (debounced)
4. Cancellation:
   - if a newer save occurs, cancel in-flight scans

### User Acceptance Checklist
- Saving TSX updates diagnostics quickly.
- Saving a `.collie` file updates dependent TSX diagnostics.

---

## Stage 5 — UX Polish and Noise Controls
### Objective
Make the feature feel intentional, not naggy.

### Implementation Steps
1. Add quick fixes (Code Actions) (optional but high impact):
   - “Add prop to Collie props block”
     - Inserts `propName?: any` (or `unknown`) into `props` with correct indentation
     - If no `props` block, create it near top
2. Add severity controls:
   - warning/error based on config
3. Add output logging behind a debug flag:
   - `collie.debug.crossFilePropsDiagnostics`

### User Acceptance Checklist
- Quick fix adds the prop correctly and formatting stays clean.
- Users can tune severity and reduce noise.

---

## Stage 6 — Module Resolution Improvements (When Needed)
### Objective
Reduce “missed matches” in real-world repos.

### Enhancements (staged)
1. Support extension-less imports:
   - `import Welcome from './Welcome'` → resolve `Welcome.collie` if it exists
2. Support TS path aliases (optional):
   - Read nearest `tsconfig.json` and use TypeScript module resolution
3. Monorepo awareness (optional):
   - Multiple `tsconfig` roots

### Implementation Steps
- Prefer TypeScript’s resolution APIs rather than reinventing it:
  - `ts.resolveModuleName(...)` with a minimal host

### User Acceptance Checklist
- Imports resolve correctly in typical Vite/React projects with aliases.

---

## Stage 7 — Documentation
### Objective
Explain what the feature does and how to configure it.

### Implementation Steps
1. README section:
   - “Cross-file props checking (React TSX)”
   - Examples of what is flagged / not flagged
   - How to avoid false positives (spreads, allowlists)
2. Configuration examples for strict vs relaxed modes.

### User Acceptance Checklist
- Docs match reality.
- Users can self-serve configuration and troubleshooting.

---

## Recommended Agent Prompt
Use this exact structure when delegating:

“Proceed with Stage X of `priority-5-plan.md`.
Do NOT write tests.
After implementation, verify manually in Extension Development Host:
- `.collie` props index builds
- TSX import + JSX usage scanning works
- unknown props produce diagnostics
- spreads do not create noisy false positives (by default).”
