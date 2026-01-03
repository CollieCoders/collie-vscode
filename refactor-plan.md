# Collie VS Code Extension Refactor Plan (Registry + `<Collie id>`)

## Context & Problem

The extension currently converts TSX selections by:

* creating a `.collie` file with `#id` defaulting to a PascalCase “component name”
* replacing selection with `<ComponentName />`
* adding `import ComponentName from './ComponentName.collie'`

That whole flow conflicts with the new runtime model:

* You should not import `.collie` files directly.
* You should render templates via `<Collie id="...">` using IDs resolved by the Vite registry.
* `.collie` files can contain **multiple** template blocks, so conversion should support **append-to-file**.

Additionally, the extension’s Collie language services currently assume a single “top-of-file #id” in some places (e.g. rename action inserts `#id` at top), which is incompatible with multiple templates per file.

---

## Stage V0 — Align Extension UX with New Architecture (Docs + Commands + Messages)

## You may ONLY touch/modify the following:

* `README.md`
* `CHANGELOG.md` (only if you want to note the behavior change)
* `package.json` (only if command descriptions live there)
* `src/features/conversion/commands.ts` (only if command titles/descriptions are defined in code)
* `src/logger.ts` (only if message text is centralized there)

## Explicitly **DO NOT** touch:

* Anything under `src/convert/**` (conversion engine stays unchanged in V0)
* Any provider/indexer code

**Complete: 0%**

### Why this stage exists

Before touching code behavior, we need the extension’s UX and wording to stop teaching the legacy workflow (direct import of `.collie`).

### Deliverables

1. Update README and any command descriptions (and any inline message strings) to reflect:

   * `.collie` files are discovered automatically (via Vite plugin)
   * runtime usage is `<Collie id="...">` with `@collie-lang/react`
   * `.collie` files can contain multiple templates separated by `#id`

2. Update any VS Code notifications/OutputChannel logging that mention “component import” to instead say:

   * “Inserted `<Collie id="...">`…”
   * “Ensured `import { Collie } from '@collie-lang/react'` exists…”

### Expected outcome

No “legacy workflow” references in docs or user-facing messages.

### Acceptance criteria

* No docs show `import Foo from './Foo.collie'`.
* Conversion command description matches new behavior (even if not implemented yet).

---

## Stage V1 — Workspace Template Index: Parse All `.collie` Files into ID → Location Map

## You may ONLY touch/modify the following:

* Create **one new module** (pick a location and stick to it):

  * Recommended: `src/lang/templateIndex.ts` (new)
* Wire into extension activation:

  * `src/extension.ts`
  * or `src/features/index.ts` + `src/features/lang/cacheWatcher.ts` depending on how you register watchers today
* If you keep shared state under `src/lang/cache.ts`, you may touch:

  * `src/lang/cache.ts` (only to store the index instance / cache results)

### Strongly prefer NOT touching (unless absolutely necessary)

* `src/features/diagnostics/**`
* `src/features/navigation/**`
* `src/features/symbols/**`

### Notes (so Codex doesn’t overbuild)

* The index should be independent: no TSX parsing here.
* Keep the parser for `#id` dead simple: line-based scanning is fine.

**Complete: 0%**

### Why this stage exists

Everything (completion, go-to-definition, diagnostics, conversion append behavior) becomes much easier if the extension maintains a workspace index of template IDs and where they live.

### Deliverables

1. Create a new “template index” module (name flexible) that:

   * finds `.collie` files in workspace (`workspace.findFiles('**/*.collie', '**/node_modules/**')`)
   * parses each file to locate **every** `#id <id>` block
   * stores:

     * `id`
     * file `Uri`
     * position range for the `#id` directive line
     * range for the block (from this `#id` to next `#id` or EOF)
   * validates ID format (`^[A-Za-z][A-Za-z0-9._-]*$`)

2. Watchers:

   * respond to `.collie` file create/change/delete
   * update index incrementally
   * debounce updates to avoid thrash

3. Provide a simple API:

   * `getById(id) -> TemplateLocation | undefined`
   * `listIds() -> string[]`
   * `listByFile(uri) -> TemplateLocation[]`

### Expected outcome

Extension can quickly answer: “Where is template `Blog.navbar` defined?”

### Acceptance criteria

* Opening a workspace with `.collie` files populates the index.
* Editing a `.collie` file updates the index within a short debounce window.
* Index correctly returns multiple templates per file.

---

## Stage V2 — Collie Language Features: Make Multi-Template the First-Class Model

## You may ONLY touch/modify the following:

* **Symbols:**

  * `src/features/navigation/documentSymbols.ts`
* **Workspace symbol support (optional):**

  * `src/features/symbols/workspaceSymbolProvider.ts`
* **Collie parsing utilities if needed:**

  * `src/lang/parseDocument.ts` (only if you want to reuse existing collie parsing)
  * OR reuse the new `src/lang/templateIndex.ts` output instead
* **Rename / code actions (only if you have one for IDs):**

  * `src/features/diagnostics/codeActions.ts` (if rename is implemented via code actions)
  * `src/features/navigation/commands.ts` (if rename is a command)

## Explicitly **DO NOT** touch:

* `src/convert/**` (conversion command not part of V2)
* `src/features/conversion/**` (save for V5)

### Implementation bias

* Use `templateIndex` as the source of truth whenever possible to avoid re-parsing.

**Complete: 0%**

### Why this stage exists

Several existing language features implicitly assume one template per file or assume the ID is on the first line.

### Deliverables

1. **Document Symbols**

   * Show each `#id` block as its own symbol entry (e.g. SymbolKind.Function or SymbolKind.Module)
   * If you currently show a single symbol per file, update to show multiple.

2. **Rename Template ID command**

   * Current code action looks only at first line and inserts `#id` at top.
   * Update so rename operates on the `#id` directive **at the cursor** (or the nearest preceding `#id` line within the same block).
   * Rename should update:

     * the `#id` value in place
     * any other references in Collie files (optional; you can defer cross-file rename to later)
   * Do **not** auto-insert `#id` at file top anymore (since it’s multi-template).

3. **Diagnostics on Collie documents**

   * Missing `#id` anywhere in the file → error (mandatory)
   * Invalid ID format → error at that `#id` line
   * Duplicate IDs (global) will be handled in V3, but you can flag within-file duplicates here.

### Expected outcome

Collie files behave like “multi-template containers,” not “single template files.”

### Acceptance criteria

* Symbols list shows all template IDs in a file.
* Rename works correctly when cursor is on/near a specific `#id` line.
* A `.collie` file without any `#id` produces a diagnostic.

---

## Stage V3 — Global ID Diagnostics: Duplicate IDs + Optional “Unknown ID Usage” Checks

## You may ONLY touch/modify the following:

* Duplicate ID diagnostics:

  * `src/features/diagnostics/provider.ts`
  * `src/features/diagnostics/compilerDiagnostics.ts` (if this is where collie diagnostics live)
* Code actions related to duplicates:

  * `src/features/diagnostics/codeActions.ts`
* If you implement “unknown id usage” diagnostics in TSX:

  * `src/features/diagnostics/tsPropsDiagnostics.ts` (this already sounds TS-oriented)
  * optionally: `src/features/featureFlags.ts` (to gate this check behind a flag)

## Explicitly **DO NOT** touch:

* Completion providers
* Definition providers
* Conversion command

### Tip

* Unknown ID usage check should be string-literal only and shallow scanning (regex or minimal AST), not a full TS program analysis.

**Complete: 0%**

### Why this stage exists

With global IDs and `<Collie id="...">`, conflicts and typos are the top DX killers. The extension should catch them early.

### Deliverables

1. Duplicate ID diagnostics (workspace-wide)

   * Using the index (V1), detect duplicates:

     * `id -> [loc1, loc2, ...]`
   * Surface diagnostics on each conflicting `#id` line
   * Provide code actions:

     * “Rename this template ID…”
     * “Open conflicting templates” (already exists; update it to work with multiple definitions)

2. Unknown ID usage diagnostics (optional MVP, but high value)

   * Parse TSX/JSX documents for `<Collie id="...">` usages
   * If the id string literal is not found in index, warn or error
   * Only enforce for string-literal ids initially:

     * `<Collie id="Blog.navbar" />` ✅ check
     * `<Collie id={something} />` ❌ skip (too dynamic)

### Expected outcome

Users don’t accidentally create collisions or typo IDs without immediate feedback.

### Acceptance criteria

* Two templates with same ID in different `.collie` files produce clear errors.
* If enabled, `<Collie id="Typo.here" />` produces a warning with suggested close matches (nice-to-have).

---

## Stage V4 — TSX/JSX Language Features: Go-to-Definition + Completion for `<Collie id="...">`

## You may ONLY touch/modify the following:

* Definition provider:

  * `src/features/navigation/definitionProvider.ts`
  * (or add a new one next to it, but prefer editing existing)
* HTML-to-collie providers are unrelated unless you reuse patterns:

  * `src/features/navigation/htmlToCollieDefinitionProvider.ts` (reference only; avoid changing)
* Completion:

  * `src/features/completions/provider.ts`
  * add a new provider file if needed:

    * e.g. `src/features/completions/collieIdProvider.ts` (new)
* Feature registration:

  * `src/features/index.ts`
* Shared index dependency:

  * `src/lang/templateIndex.ts` (read-only usage; don’t refactor it here)

## Explicitly **DO NOT** touch:

* Diagnostics provider
* Conversion command
* Formatting / semantic tokens

### Very important guardrail

* Only trigger behaviors when:

  * tag name is `Collie` (initially)
  * prop is `id`
  * value is a string literal
* Do not attempt to support `id={expr}` in MVP.

**Complete: 0%**

### Why this stage exists

If users are going to adopt this pattern, the extension should make it feel first-class:

* autocomplete IDs
* jump to definition

### Deliverables

1. Definition provider for TSX/JSX

   * When cursor is inside the string literal of `id="..."` for `<Collie ...>`, go to the matching template `#id` line in `.collie`
   * Must support:

     * `typescriptreact` and `javascriptreact`
   * Must only trigger for:

     * component tag named `Collie` (initially)
     * id prop exactly `id`
     * string literal values

2. Completion provider for TSX/JSX

   * When editing `id="|"` inside `<Collie ...>`, suggest IDs from template index
   * Use simple filtering:

     * prefix match and fuzzy-ish contains match
   * Optionally include file hint in completion detail.

3. Minimal configuration knobs (optional)

   * Allow configuring the component name(s) treated as collie runtime components:

     * default: `Collie`
     * maybe allow `CollieVite` later if you ever introduce it

### Expected outcome

Users can quickly discover and navigate templates.

### Acceptance criteria

* Go to definition from `id="Some.Template"` opens the correct `.collie` file at the `#id` line.
* Completion suggests IDs from workspace and updates when `.collie` changes.

---

## Stage V5 — Conversion Command Overhaul: Convert TSX Selection into a `#id` Block + Replace with `<Collie id="...">`

## You may ONLY touch/modify the following:

* Command implementation:

  * `src/features/conversion/convertSelectionCommand.ts`
  * `src/features/conversion/commands.ts`
  * `src/features/conversion/collieExportCommandsImpl.ts` (if it orchestrates conversion/export)
* Selection parsing:

  * `src/convert/tsx/parseSelection.ts`
  * `src/convert/tsx/jsxToIr.ts` (only if parseSelection needs it)
* TSX → Collie conversion printer:

  * `src/convert/tsx/print.ts`
  * `src/convert/collie/print.ts`
  * `src/convert/collie/astToIr.ts` (only if needed for block formatting)
* Collie file writing logic (create a helper; keep it local to conversion):

  * Prefer adding a new helper next to conversion command:

    * `src/features/conversion/collieFileWriter.ts` (new)
* Import insertion logic (create a helper; keep it local to conversion):

  * `src/features/conversion/imports.ts` (new) **OR** keep inside `convertSelectionCommand.ts` initially
* Template ID generation helper (create one; keep it local to conversion):

  * `src/features/conversion/templateId.ts` (new)

### Read-only reference allowed

* `src/lang/templateIndex.ts` (to check for collisions + decide append target)
* `src/config/collieConfig.ts` (if you want a config override for target file patterns)

## Explicitly **DO NOT** touch:

* `src/features/diagnostics/**`
* `src/features/navigation/**`
* `src/features/completions/**`
* `src/format/**`
* `src/lang/**` (other than reading the template index)

### Critical guardrails (to prevent token waste)

* Do **not** redesign the IR. Use existing IR pipelines.
* Do **not** add new AST libraries unless already present.
* Keep selection robustness bounded: 1–2 fallback attempts max.

**Complete: 0%**

### Why this stage exists

This is the “wow” feature and must match the new workflow:

* no `.collie` imports
* no generated component names
* always generates a usable `id`
* appends to a target `.collie` file when appropriate

### Deliverables

### 1) Selection robustness: handle “accidental extra selection”

Right now the command errors if the selection isn’t pure JSX.

Update selection parsing to:

* attempt to extract the JSX subtree(s) from selection even if extra tokens exist
* fail gracefully with a helpful message if no JSX is found

**Suggested strategy (practical):**

* Try parsing the selection wrapped in a fragment:

  * `<>${selection}</>`
* If that fails, scan the selection text for the first `<` and last `>` boundaries that form a parseable JSX element/fragment and retry (bounded attempts).
* If still failing:

  * show error “Selection must contain at least one valid JSX element or fragment”
  * include a short tip in output channel.

### 2) Default ID generation: deterministic + collision-safe

We want a default that’s unique “most of the time,” but also stable and readable.

**Recommended default algorithm:**

* `fileBase.scope` where:

  * `fileBase` = TSX file basename (if `index`, use parent folder)
  * `scope` = nearest named function/component that contains the selection

    * try to find the nearest ancestor:

      * function declaration name
      * const assigned arrow function name
      * component name
    * fallback: `render` or `block`
* Normalize to allowed characters (`A-Za-z0-9._-`):

  * `BlogPage.Navbar` becomes `BlogPage.Navbar` (or lowercased if you want)
  * recommend leaving case as-is; IDs are case-sensitive

**Collision handling:**

* If ID already exists in workspace index:

  * append `~2`, `~3`, etc. (or `-2`, but `~` tends to read “variant” and avoids confusing with file suffix)
* If appending to a specific file and the ID exists *in that file*, still collision-bump.

### 3) Target file selection: append by default when sensible

When converting inside `SomeComponent.tsx`, default target `.collie` file should be:

* same directory
* named after TSX file base:

  * `BlogPage.tsx` → `BlogPage.collie`
  * `index.tsx` in `Blog/` → `Blog.collie`

If that file exists:

* append a new `#id <generatedId>` block at EOF (with spacing)
  If it doesn’t exist:
* create it and write the block

If multiple templates belong together, this creates the “7 components → 7 `.collie` files” pattern naturally, but still allows users to move templates later.

### 4) Write format for appended template blocks

When appending:

* ensure there is exactly one blank line between blocks
* append:

  ```
  #id <id>

  <converted-collie-text>
  ```

### 5) Replace TSX selection with `<Collie id="...">`

Instead of `<ComponentName />`, replace with:

```tsx
<Collie id="<id>" />
```

### 6) Ensure import `{ Collie } from '@collie-lang/react'` exists

Insert:

```ts
import { Collie } from '@collie-lang/react'
```

Rules:

* If already imported, do nothing.
* If there’s an import from `@collie-lang/react` but not `Collie`, merge it:

  * `import { Something } from '@collie-lang/react'` → add `Collie` to named imports
* Insert after directives (`"use client"`) and after existing imports per your current logic.

### 7) Post-action UX

* Open the `.collie` file at the new `#id` line (or at least show it)
* Show an info message:

  * “Created/updated X.collie, inserted `<Collie id="...">`.”
* If conversion produced warnings, show warning message and direct to output channel.

### Expected outcome

The conversion command produces “production-feeling” output aligned with the new runtime model.

### Acceptance criteria

* Running conversion creates or appends to a `.collie` file with a `#id` block.
* TSX selection becomes `<Collie id="...">`.
* Import of `Collie` is present and correct.
* Re-running conversion on another block in the same TSX file appends a second `#id` block (no duplicate file names like `-1`).
* If selection contains extra stuff, the command either extracts JSX or fails with a helpful message (no confusing stack traces).

---

## Stage V6 — “Convert Again” Smart Behavior: Append to Same File + Suggest Existing IDs

## You may ONLY touch/modify the following:

* `src/features/conversion/convertSelectionCommand.ts`
* `src/features/conversion/templateId.ts` (new helper from V5)
* `src/features/conversion/collieFileWriter.ts` (new helper from V5)
* Optional config:

  * `src/config/collieConfig.ts`
  * `src/features/config/warnings.ts` (if you surface warnings to users)

## Explicitly **DO NOT** touch:

### Do not touch

* parsers / printers in `src/convert/**` unless you truly need it
* diagnostics / navigation

### Guardrail

* Similarity detection must be cheap:

  * normalized string equality first
  * optional “whitespace-insensitive equality”
  * no deep AST diffing in MVP

**Complete: 0%**

### Why this stage exists

Once users start converting multiple blocks in a single file, the extension should avoid friction:

* don’t create new files unnecessarily
* don’t create new IDs unnecessarily
* let users reuse existing templates when it makes sense

### Deliverables

1. If the target `.collie` file already exists, prefer appending into it (as in V5).

2. If user selects a block that appears identical/similar to an existing template (optional advanced):

   * detect near-match via normalized string comparison
   * offer quick pick:

     * “Create new template”
     * “Reuse existing id: X”
   * If reused, just replace selection with `<Collie id="X" />` and do not modify `.collie`.

3. Add a command option (or config) controlling behavior:

   * default: append
   * optional: always create separate files (for folks who want strict separation)

### Expected outcome

Conversion feels intelligent rather than “beta.”

### Acceptance criteria

* Multiple conversions in one TSX file append to the same `.collie` file by default.
* Optional reuse flow works without breaking default behavior.

---

## Stage V7 — Polish + Stability: Debounce, No Infinite Loops, Performance

## You may ONLY touch/modify the following:

* `src/lang/templateIndex.ts`
* `src/features/diagnostics/provider.ts` (only if diagnostics refresh needs debouncing)
* `src/features/lang/cacheWatcher.ts` (if this is where file watchers are centralized)
* `src/logger.ts` (reduce spam, add debug toggles if needed)

## Explicitly **DO NOT** touch:

* Conversion command logic
* Completion/definition logic (unless fixing a proven perf bug)

### Guardrails

* Add a debounce utility once; don’t scatter timers everywhere.
* Ensure file write operations in conversion do not re-trigger conversion.

**Complete: 0%**

### Why this stage exists

Indexing + diagnostics across workspace can become noisy or slow if done naïvely.

### Deliverables

1. Debounce index rebuilds and diagnostics refreshes.
2. Guard against repeated file writes causing cascading events:

   * conversion writes `.collie` file → index updates once → no loops
3. Ensure max file scanning doesn’t explode:

   * cap initial scan concurrency
   * exclude `node_modules`, `dist`, etc.
4. Make output channel logs helpful but not spammy:

   * one “Conversion summary” line + optional expanded debug

### Expected outcome

Extension feels fast, stable, and doesn’t spam.

### Acceptance criteria

* No noticeable lag typing in TSX or Collie files in medium repos.
* No repeated reload-like behaviors triggered by index updates.
* Diagnostics update predictably without flicker.

---

## Stage V8 — Final Cleanup: Remove Legacy Conversion Assumptions and Single-Template Heuristics

## You may ONLY touch/modify the following:

* `src/features/conversion/**` (rename “componentName” → “templateId”, remove `.collie` import logic)
* `src/convert/export/collieExport.ts` (only if it implies legacy behavior)
* `README.md` (final alignment)
* Optionally remove dead code under:

  * `src/features/conversion/collieExportCommandsImpl.ts` if it’s legacy-specific

## Explicitly **DO NOT** touch:

* Language grammar / syntax highlighting (`syntaxes/**`)
* `icon-theme.json`
* formatting engine under `src/format/**` unless it contains legacy assumptions about `#id` placement

### Guardrail

* Don’t do “cleanup refactors” outside conversion + docs. Keep it targeted.

**Complete: 0%**

### Why this stage exists

Once the new behaviors are in, remove legacy dead code and assumptions to prevent future drift.

### Deliverables

1. Remove or refactor any logic that:

   * derives PascalCase component names for template IDs
   * inserts default import of `.collie`
   * assumes `#id` only at top-of-file

2. Update any remaining commands/code actions that insert `#id` at file top (must be block-aware).

3. Normalize naming:

   * “componentName” in conversion code becomes “templateId”
   * “createCollieFile” becomes “ensureTargetCollieFile”
   * anything implying `.collie` import becomes runtime `<Collie id>`

### Expected outcome

Repo reads like the `<Collie id>` architecture has always been the intent.

### Acceptance criteria

* No code path inserts `import X from './X.collie'`.
* Conversion code uses “id/template” terminology consistently.
* Multi-template is treated as the default.
