# Collie Demo MVP — Implementation Plan (`collie-vscode` repo)

## Context & Problem

We want the VS Code demo to feel magical:

1) In a TSX file, select JSX → right click “Convert to Collie”
2) Extension creates a `.collie` file in the same directory:
   - includes `#id <PascalCaseName>`
3) Extension edits the TSX file:
   - replaces selection with a placeholder component usage
   - inserts an import at bottom of import block
4) Edit `.collie`, save → browser updates (Vite side)
5) Make `#id` invalid → see squiggle + hover + quick fix
6) Right click in `.collie` → Format Document (and optionally Fix All)
7) Right click in `.collie` → Convert to TSX (Copy to Clipboard)

Codex reported overall ~45% mostly due to missing:
- TSX replacement + import insertion
- context menu wiring for demo commands
- PascalCase `#id` diagnostic + quick fix + fix-all
- missing tooling/config UX messaging

Formatter already exists and is strong.

---

## Hard Constraints

- **Do NOT write tests.**
- Avoid architecture rewrites (no LSP migration, no major refactors).
- Prefer minimal WorkspaceEdit-based changes.
- Keep existing command IDs stable.

---

## Stage 0 — Demo Wiring Audit & Manual Checklist

**% Complete:** 0% (update after stage)

### Goals
- Add a short demo checklist and define the “demo snippet constraints” (self-contained selection).
- Confirm command IDs + where they are registered.

### Action Items
1. Add `docs/demo-checklist.md` with:
   - Open Vite project
   - Select JSX in TSX file
   - Convert to Collie
   - Edit `.collie`, format, introduce invalid `#id`, quick fix, copy as TSX
2. Verify existing command IDs used by the extension:
   - `collie.convertTsxSelectionToCollie`
   - `collie.copyAsTsx`
   - (optional) `collie.copyAsJsx`
3. Identify language id and extension association for `.collie`:
   - ensure `collie` language id exists in `package.json`

### Expected Behavior
- No runtime changes yet.

### Notes
- If any command ID naming mismatches exist between `package.json` and code, document it.

---

## Stage 1 — Context Menu Wiring for Demo Commands

**% Complete:** 0% (update after stage)

### Goals
Make right-click menu reflect the demo story without needing Command Palette.

### Action Items
1. Update `package.json` contributions to add `editor/context` entries:
   - When editor language is `typescriptreact` or `javascriptreact` and selection is non-empty:
     - show “Convert to Collie”
   - When editor language is `collie`:
     - show “Convert to TSX (Copy to Clipboard)”
     - show “Format Document” is VS Code built-in, but ensure formatter provider is registered (already is)
2. Keep menu titles exactly as the demo script expects.

### Expected Behavior
- Right click in TSX selection shows Convert to Collie.
- Right click in `.collie` shows Convert to TSX (Copy to Clipboard).

### Notes (if not 100%)
- If context conditions are tricky (selection check), allow it to always show in TSX and let command validate selection with a friendly error.

---

## Stage 2 — Convert to Collie: Auto-create `.collie` + Deterministic Naming + `#id`

**% Complete:** 0% (update after stage)

### Goals
Make “Convert to Collie” produce a file automatically in the same folder (demo-friendly), no save dialog required.

### Action Items
1. In `src/features/conversion/convertSelectionCommand.ts` (or the relevant command handler):
   - derive target directory from active TSX file URI
2. Determine component/file base name:
   - use TSX filename stem + a suffix (e.g. `AppSection`)
   - ensure PascalCase component name
3. Conflict-safe naming:
   - if `<Name>.collie` exists, try `<Name>-1.collie`, `<Name>-2.collie`, etc.
4. Generate Collie output:
   - prepend `#id <PascalCaseComponentName>` followed by newline
   - then the printed Collie body
5. Write file via `workspace.fs.writeFile`.
6. Open the new file in editor (demo momentum).

### Expected Behavior
- Running command creates `.collie` next to TSX file without prompting.
- Output starts with a valid `#id`.

### Notes (if not 100%)
- If auto-creation without save dialog conflicts with current UX design, keep the save dialog but default it to the suggested name and directory; note that demo will require one click.

---

## Stage 3 — Convert to Collie: TSX Replacement + Import Injection (WorkspaceEdit)

**% Complete:** 0% (update after stage)

### Goals
Make conversion feel end-to-end:
- selection replaced with placeholder usage
- import inserted at bottom of import block
- no duplicate imports

### Action Items
1. Create a single `WorkspaceEdit` that:
   - replaces the selected range with `<ComponentName />` (or the correct usage shape)
   - inserts import statement at the correct place
2. Import insertion rules (MVP):
   - find the last contiguous import line at top of file
   - insert after that block
   - if no imports exist, insert at top
3. Dedupe:
   - if an import from the same `.collie` path already exists, do not add another
4. Apply the edit and save the TSX file (optional but helps demo).

### Expected Behavior
- Immediately after conversion, TSX compiles with new import + placeholder usage.
- Selection is gone, replaced by placeholder usage.

### Notes (if not 100%)
- If robust import parsing is hard without AST, implement a safe heuristic:
  - scan from top until a non-import statement appears; treat that as import block end.
  Note limitations (e.g., comments or `"use client"` directives) if applicable.

---

## Stage 4 — PascalCase `#id` Diagnostic + Quick Fix

**% Complete:** 0% (update after stage)

### Goals
Show inline error + hover + quick fix for invalid `#id`.

### Action Items
1. Implement the PascalCase check in the extension diagnostics pipeline:
   - preferred: consume core diagnostic if core emits it (best long-term)
   - acceptable: add a lightweight extension-side rule that:
     - finds `#id` directive
     - validates PascalCase
     - emits a VS Code diagnostic with:
       - error severity
       - range over id token
       - code matching core if possible
       - suggested replacement stored in diagnostic data
2. Implement quick fix code action:
   - “Convert to PascalCase”
   - applies replace edit
3. Ensure hover shows message (VS Code diagnostics hover typically includes it automatically).

### Expected Behavior
- Changing `#id` to `myComponent` shows squiggle.
- Quick fix corrects it to `MyComponent`.

### Notes (if not 100%)
- If you can’t precisely compute token range, highlight the whole `#id ...` segment and note the precision limitation.

---

## Stage 5 — Fix All (Code Action) or “Format-as-fix-all” Strategy

**% Complete:** 0% (update after stage)

### Goals
Support either:
- “Fix all Collie issues” (code action), or
- a demo-friendly approach where Format also normalizes safe issues (like `#id` casing)

### Action Items (choose ONE approach)

#### Option A — Fix All Code Action (recommended)
1. Add a `SourceFixAll` or custom command:
   - “Fix all Collie issues”
2. Aggregate fixes:
   - collect all diagnostics in the document that have fix payloads
   - apply edits top-to-bottom to avoid overlapping edits
3. Include at minimum:
   - PascalCase `#id` fix

#### Option B — Format also normalizes `#id` (simplest demo UX)
1. Before formatting print:
   - normalize `#id` casing if present and invalid
2. Keep formatting stable and deterministic.

### Expected Behavior
- With multiple fixable issues, one action resolves them all.
- If using format-as-fix-all, “Format Document” cleans both whitespace and the `#id`.

### Notes (if not 100%)
- If only the `#id` rule is fixable for now, that’s fine. Note “Fix All currently applies to PascalCase `#id` only.”

---

## Stage 6 — Tooling / Config Missing UX Safety Net

**% Complete:** 0% (update after stage)

### Goals
Avoid confusing silent failure during demo:
- if no `collie.config.*` found, show a one-time actionable warning
- if required packages appear missing, show a one-time actionable warning
- do not spam

### Action Items
1. Add a helper “warnOncePerWorkspace(key, message, action?)”
   - store keys in `globalState` or `workspaceState`
2. On operations that need config:
   - if config not found, warn: “No collie.config.* found. Run `collie init`.”
3. On operations that may require packages:
   - check for presence of key packages (cheap check):
     - `workspace.findFiles('**/node_modules/<pkg>/package.json', ...)`
     - or attempt resolution with `require.resolve` using workspace root
4. Debounce / throttle warnings.

### Expected Behavior
- Missing config triggers a single warning per workspace session.
- Commands fail gracefully with guidance rather than doing nothing.

### Notes (if not 100%)
- If you can’t reliably detect packages cross-platform, keep config warning only and note that package detection is deferred.

---

## Stage 7 — Polish & Demo Script Lock-In

**% Complete:** 0% (update after stage)

### Goals
Make the actual demo smooth and repeatable.

### Action Items
1. Ensure command titles match demo narration:
   - “Convert to Collie”
   - “Convert to TSX (Copy to Clipboard)”
   - “Fix all Collie issues” (if implemented)
2. Ensure after Convert-to-Collie:
   - `.collie` file is opened automatically
   - TSX editor stays valid
3. Add one tiny “demo mode” guard if needed:
   - avoid multiple popups
   - keep toasts short

### Expected Behavior
- You can run the demo start-to-finish without touching Command Palette.
- The steps feel instantaneous and predictable.

### Notes (if not 100%)
- If any step requires manual workaround (e.g. “restart TS server”), document it explicitly in the demo checklist.
