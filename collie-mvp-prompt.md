## 🧩 Collie VS Code Extension

**Context & Problem**
You are working in the **Collie VS Code extension** repository — the companion editor tooling for the Collie template language. Collie is a Pug-inspired language that compiles `.collie` files into React TSX.

The **core Collie compiler repo** has just been updated so that a specific Collie → TSX example pair is the “golden contract” for the language surface.
In this VS Code extension repo, there are now two files in the repo root:

* `example.collie` – a realistic, idiomatic Collie template using the *current intended syntax*, including:

  * `classes` block with `$dashboardUsers` alias usage
  * shorthand classes on DOM tags (`header.dashboard-header`, `div.$dashboardUsers`, etc.)
  * `@for metric in metrics` loops
  * `@if (selectedUser)` / `@else`
  * component calls (`MetricCard(...)`, `SearchInput(...)`, `Toggle(...)`, `SuspenseLike(...)`, `Avatar(...)`, `DataTable<User>`, etc.)
  * JSX islands under `= () => ( ... )`
  * inline `{expression}` and bare inline text
  * nested HTML, Tailwind-y classes, and JSX props
* `example.tsx` – the **TSX output** that the *core compiler* generates from `example.collie`. This is the “ground truth” for what `.collie` is supposed to mean.

The **goal** for this repo is to make the VS Code experience for Collie:

* Syntactically aware of the *new* language constructs and rules.
* Aligned with the core compiler’s understanding of `.collie`.
* Pleasant and predictable when editing files like `example.collie`.

Right now, the extension’s grammar / semantic tokens / language configuration are lagging: things like `@for`, `@if`, `$classAlias`, `= () => ( ... )`, inline JSX islands, `{expr}` in text, etc. are either mis-highlighted, mis-indented, or not recognized at all.

---

### 🎯 High-Level Goal

**Update the Collie VS Code extension so that editing `example.collie` “just feels right” and matches the actual language semantics implemented in the core compiler.**

That means:

* Grammar, semantic tokens, and language configuration all understand the syntax used in `example.collie`.
* Diagnostics and tooling are in sync with the core compiler (no bogus errors on valid syntax).
* Core editing experiences (highlighting, bracket/indent behavior, basic formatting) are stable and not annoying.

You have freedom to change:

* TextMate grammar / `syntaxes/*.tmLanguage.*` or equivalent
* `language-configuration.*`
* Any TypeScript/JS code in `src/` (e.g., language server wiring, semantic tokens provider, formatting provider, diagnostics adapter, etc.)
* Activation events / contribution points in `package.json`
* Internal helpers that talk to the core compiler, if the extension shells out or uses a library

---

### ✅ Acceptance Criteria

After your changes, when the extension is built and loaded in VS Code, and the user opens `example.collie`:

1. **Correct language association**

   * `example.collie` is recognized as **Collie** (not plain text, not HTML).
   * `.collie` files receive the Collie grammar, configuration, and tooling contributions.
2. **Syntax highlighting & grammar**

   * The following constructs are highlighted in a sensible, consistent way:

     * `classes` block and alias names (`dashboardUsers`).
     * Alias usage via `$dashboardUsers` in `div.$dashboardUsers`.
     * `@for metric in metrics` loop keyword, loop variable, and iterable expression.
     * `@if (selectedUser)` / `@else` as Collie control-flow.
     * DOM tags: `div`, `main`, `section`, `header`, `aside`, `button`, `h1`, `h2`, `span`, etc.
     * Component tags: `MetricCard`, `SearchInput`, `Toggle`, `SuspenseLike`, `Avatar`, `DataTable`, `Badge`, `ActivityList`.
     * Attributes inside `(...)` including JSX-style ones (`className={rootClassName}`, `value={filter.role}`, etc.).
     * Inline JSX fragments in:

       * `fallback={<div>Loading users…</div>}`
       * `emptyState={<div>No users match this filter.</div>}`
       * The `columns={[ { …JSX render() =>(...) }, ... ]}` array, including nested `<button>`, `<Avatar>`, `<span>`, etc.
     * Inline `{expression}` in text / props (e.g. `{selectedUser.name}`, `{selectedUser.role}`, ternaries).
   * No obviously-valid parts of `example.collie` are rendered as “error red blobs” purely because the grammar doesn’t know what they are.
3. **Semantic tokens / symbol classification (if provided by this extension)**

   * Identifiers like `MetricCard`, `SearchInput`, `Toggle`, `SuspenseLike`, `Avatar`, `DataTable`, `Badge`, `ActivityList` are tokenized as component/constructor/function identifiers (not random keywords).
   * Keywords like `@for`, `in`, `@if`, `@else`, `classes`, `props` (if present elsewhere) are tokenized as control-flow / keyword tokens.
   * Interpolated expressions `{...}` get reasonable tokenization inside (e.g., variables, properties).
4. **Diagnostics behavior**

   * With the *updated core compiler* as source of truth, **`example.collie` must produce no diagnostics** when opened (no spurious parse errors or bogus warnings about indentation, `@for`, `@if`, `$dashboardUsers`, inline JSX, etc.).
   * Diagnostics should continue to be driven by the core compiler (or a shared parser library), not by duplicated hand-written heuristics that drift.
5. **Basic editing comfort**

   * Pressing Enter in places like:

     * After `@for metric in metrics`
     * After `@if (selectedUser)` / `@else`
     * Inside nested blocks
       respects Collie’s indentation model and doesn’t aggressively fight the user.
   * There are no obvious infinite loops, constant document refreshes, or extension crashes triggered simply by opening and editing `example.collie`.
   * If there is a formatter / “Format Document” for `.collie`, running it on `example.collie` does **not** destroy the structure or break syntactically-valid constructs. (It doesn’t need to be perfect, just not catastrophic.)
6. **Consistency with core compiler**

   * The extension’s understanding of what is “valid Collie syntax” is aligned with what the **core compiler** now supports for `example.collie`.
   * If you rely on a local parser library (e.g., from the core repo), make sure the extension uses the *new* capabilities instead of duplicating outdated parsing rules.

---

### 🔧 Implementation Guidance (Suggestions, Not Rules)

You should:

1. Inspect the main extension entry:

   * `package.json` contributions for `languages`, `grammars`, `commands`, `activationEvents`, etc.
   * `syntaxes/*collie*` grammar file (JSON or plist).
   * Any `language-configuration.*` file for `.collie`.
   * `src/extension.ts` or similar activation file, plus any language server / client wiring.
2. Update the **TextMate grammar** so that:

   * `@for` / `@if` / `@else` are recognized as control keywords.
   * `classes` block and alias lines are scoped so `$dashboardUsers` is highlighted as something more meaningful than generic punctuation.
   * Component calls `Name(...)` are highlighted similarly to JSX component tags.
   * `= expression` lines are treated as “expression lines”, and not as random garbage.
   * JSX inside `fallback={...}`, `emptyState={...}`, and `columns=[...]` is highlighted similarly to TSX.
3. If there is a **semantic tokens provider** or language server:

   * Ensure it uses the *same parser/AST model* as the updated core compiler when possible.
   * Update node-type handling to understand `@for`, `@if`, `$alias`, component calls, expression lines, etc.
4. If there is any **custom indentation / onEnter rules**:

   * Make sure they understand blocks introduced by `@for`, `@if`, `@else`, `classes`, etc.
5. Use `example.collie` as your primary manual test:

   * Open it in a mental/imaginary VS Code session and ensure none of the acceptance criteria above are obviously violated.

Again: these are suggestions. You are free to ignore them and take a different approach as long as the acceptance criteria are met.

---

### 🚫 Do NOT…

* Do **not** rename or modify `example.collie` or `example.tsx`. They are fixtures / golden examples, not implementation files.
* Do **not** remove `.collie` support or collapse it into generic TS/TSX.
* Do **not** invent a totally new language surface; the extension must match what the core compiler now accepts and emits.

---

### 📌 Summary

**Make any necessary changes in this VS Code extension repo so that:**

* `example.collie` is treated as a first-class Collie file.
* Syntax highlighting, semantic tokens (if applicable), and editing behavior all correctly handle the constructs used in `example.collie`.
* Diagnostics from the core compiler show `example.collie` as valid, with no false errors.
* The extension’s understanding of the language is aligned with the core compiler that compiles `example.collie` → `example.tsx`.

You may refactor, extend, or replace the existing grammar / tokens / configuration as needed to achieve this.
