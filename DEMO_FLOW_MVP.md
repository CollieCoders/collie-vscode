# Collie Demo Flow MVP — VS Code Extension Requirements

## Context & Problem

We want a live demo where a developer:
1) starts from a brand new Vite + React + TS project,
2) converts a highlighted TSX snippet into a `.collie` file,
3) sees the TSX replaced with a placeholder + import,
4) edits the `.collie` file and sees the browser update,
5) introduces invalid Collie and sees inline diagnostics + hover + quick fixes,
6) uses Format Document / Fix All to clean up formatting and fixable issues,
7) converts Collie back to TSX via “copy to clipboard” fallback.

This doc defines what the **VS Code extension** must do to make that demo smooth.
Core repo responsibilities (compiler/watch/diagnostics/config/formatting APIs) are defined in the core repo companion doc.

---

## Demo Preconditions

- Extension installed (this repo)
- Collie tooling installed in project (CLI + required packages)
- Vite dev server already running

The extension must handle gracefully:
- missing collie.config.ts
- missing tooling packages
- conversion failure (do not corrupt code)

---

## Responsibilities in THIS repo (`collie-vscode`)

## E1 — “Convert to Collie” command (TSX selection → `.collie` file + TSX placeholder injection)

**User action in demo:**
- In `src/App.tsx` (or main TSX page), user highlights a block of JSX.
- Right click → `Convert to Collie`.

### E1.1 — Command availability rules
- Available when:
  - active editor is TSX/JSX
  - selection is non-empty and contains JSX-like content
- If invoked without selection:
  - show error: “Select JSX to convert.”

### E1.2 — File creation behavior
- Create `.collie` file in **same directory** as source TSX by default.
- Naming must be deterministic and conflict-safe (suffix if needed).

### E1.3 — Conversion behavior
- Convert selection from TSX to Collie syntax.
- Prefer calling core conversion API; fallback to minimal extension converter if needed.
- Generated `.collie` should include a valid top-of-file `#id` (PascalCase).

### E1.4 — TSX placeholder injection behavior
After file creation:
1) Replace the selection with a Collie component usage.
2) Insert import for the generated component:
   - appended at bottom of existing import block
   - correct relative path
   - avoid duplicates
3) Props:
   - for demo reliability, support “self-contained” selections if full prop extraction isn’t implemented.
4) Formatting:
   - preserve indentation and avoid ugly import placement.

### E1.5 — UX feedback
- Success toast: “Created <file>.collie and replaced selection.”
- Optionally auto-open the new `.collie` file.

**Acceptance checks:**
- File created correctly, TSX modified correctly, project still compiles.

---

## E2 — Diagnostics in `.collie` files (squiggles + hover + quick fixes)

**User action in demo:**
- User edits `.collie` file: makes `#id` invalid.
- They immediately see error squiggle, hover text, and quick fix.

### E2.1 — Diagnostic source
Diagnostics can come from:
- language service / LSP
- invoking core “lint/analyze” in-process or via CLI JSON mode
- watcher-based analysis

But must be surfaced via VS Code diagnostics API.

**Update cadence:**
- on-save minimum acceptable for demo
- as-you-type if performant and stable

### E2.2 — Hover details
Hover should show:
- diagnostic message
- optionally suggested fix result

### E2.3 — Quick fix (single issue)
Provide code action:
- “Convert to PascalCase” (or similar)
- applies fix precisely to range

### E2.4 — Quick fix all (file-wide)
Provide one of these (whichever is easiest to implement cleanly):
- A “Fix all Collie issues” code action that applies multiple edits, OR
- Rely on formatting pipeline (E3) if formatting also applies safe fixes

**Acceptance checks:**
- invalid `#id` yields diagnostic
- single quick fix resolves it
- fix-all resolves multiple issues when present

> ⚠️ Demo-killer: diagnostics only showing in Output panel.
> Must be inline squiggles + hover.

---

## E3 — Format Document for Collie (and optionally “format fixes formatting errors”)

**User action in demo:**
- Right click anywhere in `.collie` file → `Format Document`
  - (or command palette → Format Document)

### E3.1 — Provide a formatter for Collie documents
Implement one of:
- `DocumentFormattingEditProvider` for Collie language id, OR
- hook into an LSP formatter (if you have an LSP)

Formatter should call core’s formatter if available, otherwise use extension formatter.

**Behavior:**
- Produces stable, consistent formatting
- Formatting is safe (does not change semantics)
- Runs quickly enough for a demo

### E3.2 — “Format and fix” (optional shortcut)
If easiest, allow formatting to also correct certain fixable issues (like `#id` casing),
but only if that behavior is deterministic and won’t surprise users.

**Acceptance checks:**
- messy file formats cleanly
- repeated formatting does not keep changing output

---

## E4 — “Convert to TSX” command (Collie → clipboard)

**User action in demo:**
- Right click anywhere in `.collie` file → `Convert to TSX (Copy to Clipboard)`

**Expected behavior:**
- Convert entire document to TSX
- Copy to clipboard
- Toast: “Converted TSX copied to clipboard.”
- Do not modify files automatically

**Acceptance checks:**
- Clipboard paste compiles for demo snippet.

---

## E5 — Tooling missing / misconfigured messaging (demo safety net)

Even though the CLI should self-heal installs, the extension should still handle:
- missing `collie.config.ts`
- missing compiler/vite plugin/runtime packages

**Behavior:**
- show actionable message with:
  - what’s missing
  - how to fix (`collie init` / install command)
- do not spam (debounce repeated popups)

---

## Non-Goals (do not overbuild for demo)

- Perfect TSX ↔ Collie round-trip fidelity
- Full type inference across file boundaries
- Supporting complex TSX expressions in selection conversion
- Formatting every edge case perfectly

Priority is a reliable happy path + diagnostics + quick fix/fix-all + format.

---

## Edge cases to guard against (minimum)

- Multiple selections: support first selection only or block with message
- No workspace open: block with message
- Unsaved TSX file: prompt to save before conversion
- Import insertion when:
  - no imports exist
  - imports are oddly structured
- Fix-all overlapping edits: apply fixes in a stable order (top to bottom)

---

## “Done” Definition for Extension Repo (Demo Ready)

Extension is demo-ready when:
- Convert to Collie works reliably (file creation + TSX replacement + import injection)
- `.collie` files show inline diagnostics with hover + quick fix
- Fix-all exists (either dedicated or via formatting if formatting also fixes)
- Format Document works on `.collie` files
- Convert to TSX copies to clipboard and provides clear success messaging

---

## Do NOT write tests

This demo MVP work should not add or modify automated tests unless explicitly requested later.
Focus on reliable editor UX and the end-to-end demo flow.
