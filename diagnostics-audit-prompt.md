# Context & Problem

Repo: `collie-vscode`

You already implemented a previous change intended to make diagnostics update on unsaved edits by:
- revalidating on `onDidChangeTextDocument` (debounced), and
- preferring open-buffer text over disk when reading dependency files.

However, we must now VERIFY the implementation covers ALL cross-file diagnostics correctly — especially diagnostics that depend on CSS files (e.g. “no matching classes” when a class is used in `.collie` but not found in any CSS/SCSS/LESS).

The problem we’re solving: diagnostics should clear/update WITHOUT requiring saves for any dependency type (TSX/TS/JSX/JS and CSS/SCSS/LESS, plus any other dependencies we already support).

Your task: audit what was implemented, and if any of the callouts below are missing or incomplete, implement them.

Do NOT refactor unrelated features. Keep changes minimal and targeted.

# Callouts that MUST be true (verify + fix)

## Callout A — We must NOT only watch `.collie`
Diagnostics in `.collie` depend on many file types.

VERIFY that the revalidation trigger includes changes to at least:
- `.collie`
- `.tsx`, `.ts`, `.jsx`, `.js`
- `.css`, `.scss`, `.less`

If the current implementation only triggers on `.collie` (or misses CSS), update the filters so changes in TSX/CSS also schedule revalidation (debounced).

## Callout B — Cross-file revalidation must revalidate `.collie` docs when dependencies change
VERIFY behavior:

- When a dependency doc changes (TSX/TS/JSX/JS/CSS/SCSS/LESS), we must revalidate **all OPEN `.collie` documents** (simple + robust).
- When a `.collie` doc changes, validate that `.collie` doc (and optionally open `.collie` docs if caches are shared, but default to validating just the changed doc unless you know cross-caches require more).

If the current implementation only revalidates the changed file, it will not clear Collie warnings caused by edits in other files. Fix accordingly.

## Callout C — Dependency file reads must prefer open buffers for ALL dependency types (especially CSS)
This is the most common remaining bug: event wiring exists, but the indexers still read from disk so unsaved changes aren’t visible.

VERIFY that ANY code that reads file CONTENTS for analysis uses open-buffer-preferred reads:
- Implement or reuse a single helper `getTextPreferOpenDoc(uri: Uri): Promise<string>`:
  - if `workspace.textDocuments` contains the `uri`, return `doc.getText()`
  - else read from disk via `workspace.fs.readFile(uri)` and decode UTF-8

Then ensure it is used for:
- TSX/TS content reads in diagnostics (`tsPropsDiagnostics.ts` or helpers it calls)
- CSS/SCSS/LESS content reads in CSS indexer (`src/features/css/indexer.ts` / `classIndex.ts`)

If CSS indexing uses disk reads, ripgrep, or `findTextInFiles`, you MUST still override content for open docs (enumeration can stay; content must come from the open buffer when available).

## Callout D — Debounce and stale-run protection
VERIFY we have:
- debounce around 150–300ms for `onDidChangeTextDocument` to prevent thrash
- a minimal “latest-run wins” guard so older async validations do not overwrite new results

If missing, implement it in the diagnostics provider layer (where diagnostics are published).

# Implementation guidance (only if needed)

### 1) “Relevant doc” predicate
Make sure the predicate includes:
- languageId check (if available) OR extension check:
  `.collie`, `.tsx`, `.ts`, `.jsx`, `.js`, `.css`, `.scss`, `.less`

### 2) Scheduling strategy (simple)
On any relevant dependency change:
- schedule a flush that calls `revalidateOpenCollieDocs()`.

### 3) CSS indexer update
If the CSS indexer builds a class map by reading files from disk:
- swap the disk read for `getTextPreferOpenDoc(uri)`
- ensure reindex happens when a CSS doc changes (the diagnostics revalidation can force it, or the CSS indexer can listen to edits; pick the minimal change consistent with the existing architecture).

# Acceptance criteria (must manually verify)

## A) Missing ID clears without saving
1) Open `.tsx` and related `.collie`.
2) Produce missing `#id` warning in `.collie`.
3) Edit `.tsx` to add the missing id but DO NOT save.
4) Warning clears within ~0.3s.

## B) No matching classes clears without saving (NEW)
1) Open `.collie` with “no matching classes” warning for `.someClass`.
2) Open relevant `.css`/`.scss`/`.less` file.
3) Add `.someClass {}` but DO NOT save.
4) Warning clears within ~0.3s.

## C) No idle loops / CPU burn
Typing should not cause constant revalidation when idle. Debounce must work.

# Do NOT write tests

Do NOT add or modify any tests.

# Deliverables

- If any of the callouts A–D are missing or incomplete in the current codebase, implement the minimal fixes.
- Keep changes scoped to diagnostics scheduling + open-buffer reads + CSS indexing as needed.
- Add small inline comments explaining why open-buffer reads are required (unsaved changes must be visible to diagnostics).
