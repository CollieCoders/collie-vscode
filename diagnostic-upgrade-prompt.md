# Context & Problem

Repo: `collie-vscode`

Right now, diagnostics (especially the TS/TSX-prop-related warning shown in `.collie` files like “no matching ID for `#id`”) only disappear after saving the related TSX/React file. This happens because our diagnostics/indexing logic reads dependency files from disk, so it can’t see unsaved in-memory changes in open editors.

Goal: Make diagnostics update as the user types (unsaved changes), and clear warnings without requiring file saves.

Example repro:
1) Convert TSX -> Collie.
2) `.collie` shows warning on `#id` about missing matching ID.
3) The TSX file had the ID inserted automatically but is unsaved.
4) Today: warning persists until save.
5) Desired: warning clears shortly after the TSX edit occurs, even if unsaved.

# Where to work (based on repo structure)

Diagnostics live under:
- `src/features/diagnostics/provider.ts` (likely owns the DiagnosticCollection + event wiring)
- `src/features/diagnostics/tsPropsDiagnostics.ts` (computes the “missing id/prop” warnings)
- potentially uses shared debounce utilities: `src/shared/helpers/debounce.ts` or `src/lang/templateIndex/helpers/debounce.ts`
- conversion code may be involved in triggering revalidation after generating files: `src/features/conversion/collieFileWriter.ts` (only if needed)

You previously found `DiagnosticCollection` references in:
- `src/features/conversion/collieFileWriter.ts`
- `src/features/diagnostics/tsPropsDiagnostics.ts`

Your job is to locate where the DiagnosticCollection is created/managed (likely `src/features/diagnostics/provider.ts` or `src/extension.ts` / `src/features/index.ts`) and implement “validate on change” + “prefer open documents” in the diagnostics pipeline.

# Required behavior changes

## 1) Revalidate on unsaved edits (not just saves)
Add/change event wiring so diagnostics are recomputed on:
- `workspace.onDidChangeTextDocument` (debounced)
- `workspace.onDidOpenTextDocument`
- `workspace.onDidCloseTextDocument`
- keep `workspace.onDidSaveTextDocument` (still useful)

Important: the `.collie` diagnostics depend on TSX/TS/JSX/JS edits. So when a TSX/TS doc changes, you must trigger revalidation of Collie docs (at least the open Collie docs).

## 2) Prefer in-memory text for open documents
Anywhere the diagnostics pipeline reads TSX/TS/CSS/etc file contents, it MUST prefer open buffers:
- if the file is open in VS Code (exists in `workspace.textDocuments`), use `doc.getText()`
- otherwise read from disk using `workspace.fs.readFile(uri)`.

Implement a single helper, e.g.:
- `getTextPreferOpenDoc(uri: Uri): Promise<string>`

Then replace file-content reads inside diagnostics computations with this helper (especially in `tsPropsDiagnostics.ts` and any helper it calls).

## 3) Cross-file invalidation strategy (simple + robust)
When ANY relevant doc changes (tsx/ts/jsx/js/collie, and optionally css/scss/less if those affect diagnostics), do:
- Revalidate all *open* `.collie` documents.

Do NOT implement a full-workspace reindexer or expensive watchers unless absolutely required.

## 4) Avoid thrash + stale overwrites
- Debounce revalidation by ~150–300ms.
- Add a minimal “latest run wins” guard per Collie document so async runs don’t publish stale results.

If there’s an existing debounce helper in `src/shared/helpers/debounce.ts`, use it. Otherwise implement a tiny local debouncer in the diagnostics provider module.

# Concrete steps (implementation checklist)

1) Find the diagnostics entrypoint:
   - Search for `createDiagnosticCollection`, `languages.createDiagnosticCollection`, `DiagnosticCollection`, or `diagnostics.set`.
   - Likely locations: `src/features/diagnostics/provider.ts`, `src/features/index.ts`, `src/extension.ts`.

2) Add a debounced scheduler:
   - `scheduleRevalidate(uri)` adds to a Set and triggers a timer.
   - On flush:
     - if the changed doc is `.collie`, validate it
     - otherwise, validate all open `.collie` docs (the main fix)

3) Add change listeners:
   - `onDidChangeTextDocument`: if document language or extension is relevant, call `scheduleRevalidate(document.uri)`
   - `onDidOpenTextDocument`: schedule
   - `onDidCloseTextDocument`: schedule (closing removes in-memory view)
   - `onDidSaveTextDocument`: schedule

Relevant languages/extensions:
- collie: `.collie`
- react/typescript: `.tsx`, `.ts`, `.jsx`, `.js`
- optionally styles: `.css`, `.scss`, `.less`

IMPORTANT: This must NOT only watch `.collie`.

Diagnostics include “no matching classes” and similar checks that depend on CSS-family files. Therefore:

- Treat changes in `.css`, `.scss`, `.less` as triggers to revalidate open `.collie` documents (debounced), even when those style files are unsaved.
- Ensure any CSS indexing logic (`src/features/css/indexer.ts`, `src/features/css/classIndex.ts`) reads file contents using the same `getTextPreferOpenDoc(uri)` helper (open buffer first, disk second).

4) Implement `getTextPreferOpenDoc(uri)` in a sensible shared place:
   - Prefer placing it near diagnostics helpers (e.g. `src/features/diagnostics/helpers/`), or in `src/shared/helpers/text.ts` if that’s where file helpers live.
   - Ensure there is only ONE “prefer open doc” helper; don’t duplicate.

Pseudo:
```ts
async function getTextPreferOpenDoc(uri: vscode.Uri): Promise<string> {
  const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString("utf8");
}
```

5. Update `src/features/diagnostics/tsPropsDiagnostics.ts`:

   * Identify where it reads TSX/TS source to build ID/prop indexes.
   * Replace disk reads with `getTextPreferOpenDoc(uri)`.
   * If it uses workspace search or ripgrep for content extraction, keep the enumeration but override content for open docs.

6. Add stale-result guard:

   * Keep `Map<string, number>` keyed by Collie doc URI string.
   * Increment on validation start; only publish diagnostics if the run is still latest.

7. Ensure clearing behavior:

   * When diagnostics are recomputed and an issue is resolved, the warnings should be removed via `diagnosticCollection.set(doc.uri, [])` (or equivalent).

# Constraints / quality bars

* Minimal changes; do not refactor unrelated features.
* No refresh loops; no continuous revalidation while idle.
* Prefer revalidating only open `.collie` docs to keep cost low.
* Keep naming obvious (`scheduleRevalidate`, `revalidateOpenCollieDocs`, `getTextPreferOpenDoc`).
* Use existing debounce utilities if present.

# Do NOT write tests

Do NOT add/modify tests for this change.

# Deliverables

* Code changes implementing:

  1. validate-on-change (debounced) for relevant documents
  2. open-buffer-preferred content reads for dependency files
  3. cross-file revalidation of open `.collie` docs when TSX changes
  4. stale-run guard to prevent outdated diagnostics overwriting newer results

* Add a short comment near `getTextPreferOpenDoc` explaining why it’s required (unsaved edits must be visible to diagnostics).
