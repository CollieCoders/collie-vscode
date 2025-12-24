## 1. Current collie-vscode issues / mismatches

These are based on the current `collie-vscode` repo layout (no edits, just reading):

### 1.1 No concept of template `id` in the language model

* The extension’s internal parser (`src/format/parser/parse.ts` + `ast.ts`) models:

  * `RootNode` with `children`, `props?: PropsDecl`, `classAliases?: ClassAliasesDecl`.
  * No `id` or `rawId` on `RootNode`.
* The VS Code language features (semantic tokens, diagnostics, navigation, etc.) are all built on this internal AST.
* Given your new design (“`#id` / `id` directive at top of file drives template identity and HTML file name”), this means:

  * The extension **has no way to know a template’s logical id**.
  * It can’t:

    * Highlight it specially.
    * Enforce uniqueness across files.
    * Relate it to HTML placeholders (like `id="homeHero-collie"`).

So as soon as the core compiler and HTML runtime fully embrace the `id` directive, the extension is **lagging behind conceptually**.

---

### 1.2 Top-of-file directive syntax is outdated (no `id`, probably not aligned with `#props` / `#classes`)

* The internal parser currently treats **plain words** `props` and `classes` as the top-level headers:

  * `parse.ts` looks for `trimmed === 'props'` and `trimmed === 'classes'`, enforces “top level only” and indentation rules, etc.
  * Semantic tokens (`src/features/semanticTokens/tokenize.ts`) look for:

    ```ts
    const propsKeywordPattern   = /^(\s*)(props)\b/;
    const classesKeywordPattern = /^(\s*)(classes)\b/;
    ```

* The TextMate grammar (`syntaxes/collie.tmLanguage.json`) highlights:

  ```json
  "classesKeyword": {
    "patterns": [
      {
        "name": "storage.type.classes.collie",
        "match": "^\\s*(classes)\\b"
      }
    ]
  },
  "propsKeyword": {
    "patterns": [
      {
        "name": "storage.type.props.collie",
        "match": "^\\s*(props)\\b"
      }
    ]
  }
  ```

* There is **no dedicated support for `#id`, `#props`, `#classes`, or `id` / `ID` / `iD`** as directives.

* Given where you’re heading (explicit directive syntax at the top, strict ordering: `id` before `props` / `classes` / template), this means:

  * Collie files that adopt `#id` / `id` will **not get special syntax highlighting** for the directive in the current extension.
  * The extension may treat `#id` as just another tag / element name (depending on how the rest of the line looks).
  * Any future “id-first” validation in the compiler won’t be surfaced in the editor.

---

### 1.3 Semantic tokens don’t distinguish directive keywords vs directive values in a way you need for IDs

* Current semantic token types (`src/features/semanticTokens/legend.ts`) include:

  * `collieTag`, `collieClassShorthand`, `collieDirective` (for `@if`, `@for`, etc.).
  * `colliePropsKeyword`, `colliePropsField`.
  * `collieClassesKeyword`, `collieClassAliasName`, `collieClassAliasUsage`.
  * Nothing for `id` / template identifiers.

* The tokenizer (`tokenize.ts`) does not emit any token type for:

  * A top-of-file `id` keyword.
  * The id’s **value** (`homeHero`) as a distinct semantic token.

* The theming in `package.json` has explicit colors for:

  ```json
  "collieTag", "collieClassShorthand", "collieDirective",
  "colliePropsKeyword", "colliePropsField",
  "collieInterpolation", "colliePipeText", "collieComment",
  "collieClassesKeyword", "collieClassAliasName", "collieClassAliasUsage"
  ```

  but nothing that could be repurposed for `id`.

**Bottom line:** even after we teach the parser about `id`, you won’t get the “id stands out in bright red/purple” effect until semantic tokens + theming are extended.

---

### 1.4 Diagnostics are props-centric and directive-centric — no workspace-level ID analysis

* Diagnostics provider: `src/features/diagnostics/provider.ts`:

  * Converts parser diagnostics (errors/warnings from your internal parser).
  * Adds some **props-specific** validation logic:

    * Finds `props` block, enforces indentation, field syntax, etc.
  * Has a `SUPPORTED_DIRECTIVES` set for `@if`, `@elseIf`, `@else`, `@for` and presumably complains / ignores unknown directive lines.

* What it does **not** do:

  * Track template IDs across the workspace.
  * Enforce uniqueness of IDs (explicit or derived from filename).
  * Relate ids in `.collie` files to HTML anchors like `id="homeHero-collie"`.

So:

* **No red squiggles** for duplicate IDs or colliding filename-based IDs.
* **No yellow squiggles** when an id is never used in HTML placeholders.

This is exactly where your new design wants to lean on the extension, and it’s currently empty.

---

### 1.5 Potential fragility as core syntax evolves

More subtle but worth noting:

* The extension maintains its **own parser** (`src/format/parser`) rather than reusing the core compiler’s AST/types.
* As you evolve the core language (new directives, `id` semantics, changes to `classes` / `props`), the extension can silently drift:

  * It might parse a file “successfully” but with different semantics than the real compiler.
  * Diagnostics and formatting may contradict what `@collie-lang/compiler` does at build time.

Short term, this mostly shows up as “extension doesn’t understand `id`”. Long term, it’s the place you’ll keep tripping if core and extension aren’t updated in lockstep.

---

## 2. Plan / user story for new id-related features

Here’s the “story + stages” version that you can basically turn into an `id-features-plan.md` (or similar) later.

### 2.1 User story

> **As a Collie user**,
> I want my template `id` directives to:
>
> * Stand out visually in `.collie` files,
> * Be validated for uniqueness across my project, and
> * Warn me when a template won’t render because no matching HTML placeholder exists,
>
> so that I can confidently wire Collie templates to my HTML pages without subtle id collisions or “why isn’t this rendering?” confusion.

We’ll break that into three concrete deliverables:

1. **Syntax & semantic highlighting for `id` and other top-level directives.**
2. **Workspace-level ID uniqueness diagnostics (errors + Quick Fix).**
3. **HTML anchor mismatch warnings (no matching `*-collie` placeholder).**

---

### 2.2 Stage 1 – Syntax + semantic highlighting for `id`

**Goal:** Give `id` and its value a unique visual identity distinct from tags/props/classes so it pops immediately.

**High-level behavior**

* Recognize these forms (case-insensitive keyword, normalized id):

  ```collie
  #id homeHero
  #id = homeHero
  #id: homeHero

  id homeHero
  id = homeHero
  id: homeHero

  ID homeHero
  iD homeHero
  ```

* Normalize the logical id with the same rules as the core compiler:

  * Strip trailing `-collie` from the value.
  * So `id homeHero-collie` and `#id homeHero` both map to logical id `"homeHero"`.

**Extension impact**

1. **Parser / AST**

   * Extend `RootNode` in `src/format/parser/ast.ts` to carry:

     ```ts
     id?: string;     // normalized
     rawId?: string;  // exact text from directive
     idSpan?: SourceSpan; // where to put squiggles / hovers
     ```

   * Update `parse.ts` to:

     * Detect `id` / `#id` lines at top of file (like it already does for `props` / `classes`):

       * Must be before any template nodes.
       * Must be before `props` / `classes` (or we at least warn if order is wrong).
     * Parse the value (`homeHero`, `homeHero-collie`, etc.), normalize it, store `id` and `rawId`.
     * Use `idSpan` for diagnostics.

2. **Semantic tokens**

   * Add new semantic token types in `legend.ts`, e.g.:

     ```ts
     'collieIdKeyword',
     'collieIdValue',
     ```

   * In `tokenize.ts`:

     * Detect the id directive line (reuse same regex logic as parser to avoid drift).
     * Emit:

       * `collieIdKeyword` for the keyword (`id` / `#id`).
       * `collieIdValue` for the actual identifier (`homeHero`).

   * Keep token overlaps rules consistent with comments / pipe text / interpolations.

3. **Theming**

   * In `package.json`, under `editor.semanticTokenColorCustomizations.rules`, add:

     ```json
     "collieIdKeyword": "#FF4B8A",   // or some bright, clearly unique color
     "collieIdValue": "#FFCC00"
     ```

   * Goal: the directive *jumps out* from the rest of the file, not blending with tags or props.

**Acceptance criteria**

* In a `.collie` file, `id homeHero` at the top is:

  * Parsed into `RootNode.id === "homeHero"`, `rawId === "homeHero"`.
  * Semantic tokens include `collieIdKeyword` and `collieIdValue` at the correct spans.
  * Colors in the default theme clearly distinguish id keywords/values from tags / props / classes.

---

### 2.3 Stage 2 – Workspace-level ID uniqueness diagnostics

**Goal:** Catch duplicate template IDs early and explain exactly what’s wrong.

We need to cover several cases:

1. Two files with the **same filename** and **no explicit id**
   → both derive `id` from filename → collision.

2. A file with explicit `id` colliding with:

   * Another file’s explicit `id`, or
   * Another file’s *implicit* id (derived from filename).

3. Any `id` value that normalizes to the same logical id:

   * `homeHero` vs `homeHero-collie`.

**Core strategy**

* Build a **workspace index of Collie templates**:

  ```ts
  interface TemplateIdEntry {
    id: string;           // normalized logical id
    rawId?: string;
    uri: Uri;
    idSpan?: SourceSpan;  // if explicit id
    derivedFromFilename: boolean;
  }
  ```

* For each `.collie` document:

  * Parse it (reuse existing cache in `src/lang/cache.ts`).
  * Compute:

    ```ts
    logicalId =
      root.id ??
      normalizeIdFromFilename(document); // strip "-collie", no extension
    ```

* Maintain a map:

  ```ts
  Map<string, TemplateIdEntry[]>
  // key = logical id, value = all locations that define it
  ```

**Diagnostics behavior**

* In diagnostics provider (or a dedicated ID diagnostics module):

  * For each template id detected:

    * Look up `entries = idIndex.get(id)`.
    * If `entries.length > 1`:

      * For each entry, emit a **DiagnosticSeverity.Error** on:

        * `idSpan` (if explicit `id`), or
        * The filename “stem” part (if implicit).
      * Message examples:

        * `"Duplicate Collie template id 'homeHero'. Templates must have unique ids. Also defined in: <path1>, <path2>."`
        * Differentiate “implicit from filename” vs “explicit `id`”.

* Special case behavior (matching your spec):

  * If two files share the **same basename** and **both lack explicit `id`**:

    * Treat that as an error: “Two templates share the same derived id 'hero'. Either rename one file or add a unique `id` directive.”
  * If a file *adds* an explicit `id` that collides with someone else’s:

    * Same error; the message should explicitly mention the other file and whether its id is implicit or explicit.

**Quick Fix ideas**

You asked for possible `Quick Fix` support; these are natural candidates:

* For a duplicate id error:

  * “Rename id in this file…”:

    * Suggest a new id (e.g. `${id}2`) or leave it as an editable placeholder in the rename UI.
  * “Open other template with id 'homeHero'”:

    * Code action that jumps to the conflicting file.

We can design these as separate stages, but they’re tightly coupled to the diagnostics, so keeping them in the same “Stage 2” plan makes sense.

**Acceptance criteria**

* If two `.collie` files would compile to the same logical id, **both** show red squiggles.
* Diagnostics messages are explicit about:

  * The id value,
  * Whether it’s derived from filename or from `id` directive,
  * Where the other conflicting definitions are.
* Fixing the conflict (renaming file or `id`) clears the error on the next diagnostics pass.

---

### 2.4 Stage 3 – “No matching anchor” warnings (HTML placeholders)

**Goal:** Warn when a template id is never referenced in any HTML file via an `*-collie` placeholder, so users don’t silently compile templates that never render.

**Runtime contract reminder**

* DOM placeholder id: `<id>-collie`.
* HTML partial URL: `/collie/dist/<id>.html`.
* Collie runtime maps `id="<id>-collie"` → fetch `/collie/dist/<id>.html`.

**Extension behavior**

* For each template id (same index from Stage 2), check if there exists a **matching HTML anchor** in the workspace:

  * Files: `**/*.html` (and optionally `.htm`, maybe `.astro` / `.ejs` later, but start with HTML).
  * Pattern: `id="<id>-collie"` (or perhaps more robust regex, but that’s the intent).

**Implementation approach**

* Maintain a second index:

  ```ts
  Map<string, Set<Uri>> // logicalId -> HTML files that contain id="<id>-collie"
  ```

* Populate / update it by:

  * Scanning `*.html` on extension activation (or lazily on first use).
  * Watching HTML files for changes (using VS Code’s `workspace.createFileSystemWatcher`).
  * For simplicity, initial implementation can re-scan the file on save and update the id→URI sets.

* In diagnostics:

  * For each template id:

    * If `idIndex` says it’s defined and `htmlAnchorIndex` says there are **no** HTML anchors:

      * Emit a **warning** (not error) on the id directive span (or filename if implicit).

  * Diagnostic message example:

    * `"No matching Collie placeholder found in HTML for id 'homeHero'. The runtime looks for an element like id=\"homeHero-collie\" in your HTML. This template will not render until such a placeholder exists."`

**Quick Fix ideas**

* “Search for `homeHero-collie` in workspace”:

  * Open the search pane pre-filled.
* Later: “Insert placeholder snippet into current HTML file” if the active editor is HTML.

**Acceptance criteria**

* Adding `id homeHero` in a `.collie` file when no `id="homeHero-collie"` exists anywhere produces a **warning** on the id.
* Once the developer adds `<div id="homeHero-collie"></div>` to any HTML file, the warning disappears on the next diagnostics run.
* Behavior is performant enough (no constant full-workspace rescans; watchers + incremental updates).

---

## 3. Other VS Code features that would be genuinely useful

Here’s a short list of additional features that play nicely with everything above and are actually worth implementing:

1. **HTML ↔ Collie “Go to Definition”**

   * From HTML:

     * Cmd+Click on `id="homeHero-collie"` → jumps to the `.collie` file with `id homeHero` (or implicit `homeHero`).
   * From Collie:

     * Cmd+Click on `id homeHero` → jumps to all matching HTML anchors (if multiple, show a picker).
   * This closes the loop between the editor and the runtime contract.

2. **“Open compiled HTML partial” command**

   * Command: `Collie: Open compiled HTML partial for this template`.

   * Uses the same id logic:

     ```text
     id -> /public/collie/dist/<id>.html
     ```

   * Opens the HTML file in a new editor tab if it exists.

   * Great for debugging sanity: “what is this actually compiling to?”

3. **Workspace symbol / outline for templates**

   * Expose each template as a **workspace symbol**:

     * Name: `<id>` (or `<id> (from filename)` if implicit).
     * Container: relative path.
   * In the `.collie` file outline:

     * Show the id, props, and classes blocks at the top, then sections (headers, etc.) as symbols.

4. **Id-aware completions / snippets**

   * When editing HTML:

     * Offer completion for `id="<id>-collie"` based on known template ids from the Collie index.
   * When editing `.collie`:

     * Snippet: `id` block at the top of file with a derived id suggestion from filename.

5. **“Collie Problems” view / grouping**

   * Not a new feature so much as organization:

     * Group diagnostics by id (e.g. “ID: homeHero” → duplicate, unanchored, etc.).
     * Helps when refactoring multiple templates at once.

---

If you like, when you’re fresh we can turn Sections 2.2–2.4 into a proper `id-features-plan.md` with stages, file-by-file guidance, and specific acceptance criteria in the same style as your other plans — something you can feed straight to Codex/Roo like “implement Stage 1 of id-features-plan.md”.
