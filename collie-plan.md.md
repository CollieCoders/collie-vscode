# VS Code Extension Implementation Plan

## VS Code Repo Stages (`collie-vscode`)

### Stage V1 — Formatter must preserve `#id` (critical)

**Problem**

* Format Document deletes the `#id` directive at the top of `.collie` files.
* Root cause: formatter parses `#id` into the RootNode (`root.rawId` / `root.id`) but the printer does not print it, so parse→print drops it.

**What to do**

* Update the formatter printer to print the id directive at the top of the file whenever present.
* Use canonical form: `#id <value>`.
* Prefer printing `root.rawId` if available (preserve original value like `App.App`).

**Where**

* `src/format/printer/print.ts`

**Expected behavior**

* Input:

  ```collie
  #id App.App

  div
    p | Hello
  ```
* After Format Document:

  * `#id App.App` is still the first non-empty line.
  * Formatting does not delete or move it below props/nodes.

---

### Stage V2 — Syntax highlighting: `//` inside strings must NOT start a comment

**Problem**

* URLs like `"https://vite.dev"` get highlighted as comments after `//` because TextMate grammar matches `//.*$` without string protection.

**What to do**

* Add proper string rules (single and double quotes) to the TextMate grammar.
* Ensure strings are tokenized before comment patterns so comments do not fire inside quotes.

**Where**

* `syntaxes/collie.tmLanguage.json`

**Expected behavior**

* `href="https://vite.dev"` highlights the entire quoted value as a string.
* Actual `// comment` lines still highlight as comments.

---

### Stage V3 — Parser/diagnostics: allow nested indentation (`a` → indented `img`) and format accordingly

**Problem**

* The extension currently errors on correct nested blocks like:

  ```collie
  div
    a(...)
      img(...)
  ```

  saying indentation “jumped more than one level.”
* It incorrectly prefers the flat sibling form:

  ```collie
  div
    a(...)
    img(...)
  ```
* Formatter should output the nested structure if that’s what the AST represents.

**What to do**

* Fix indentation stack logic in the **extension parser** so children are valid when indented one level deeper than the parent.
* Ensure the formatter printer prints children at exactly one indent deeper than their parent (no flattening).

**Where**

* Parser: `src/format/parser/parse.ts` (indent tracking + parent stack)
* Printer: `src/format/printer/print.ts` (indentation based on AST structure)

**Expected behavior**

* This should be valid (no indentation error):

  ```collie
  div
    a(href="https://vite.dev")
      img.logo(src={viteLogo})
  ```
* Format Document should preserve/normalize nested structure:

  * `img` remains indented under `a`.

---

### Stage V4 — Diagnostics: prop validation rules must match compiler

**Problem**

* Extension shows: “Prop X used but not declared in props block” even for `{props.viteLogo}`.
* Desired rule:

  * Bare `{viteLogo}` must be declared in `props` block.
  * `{props.viteLogo}` is always allowed (even without a props block).

**What to do**

* Update extension diagnostics to classify usages:

  * bare identifier vs namespaced `props.<name>`
* Only bare identifiers are checked against the `props` block.
* Namespaced `props.<name>` should not error.

**Where**

* Whatever module emits the “prop used but not declared” diagnostic (likely under `src/features/diagnostics/` or similar).

**Expected behavior**

* No props block:

  * `src={viteLogo}` → diagnostic
  * `src={props.viteLogo}` → no diagnostic
* With props block declaring `viteLogo`:

  * both forms allowed

---

### Stage V5 — Converter: TSX selection → `<Collie ... />` must pass variables as props, and Collie file must generate a `props` block

**Problem**

* Conversion generates `{viteLogo}` / `{reactLogo}` in the `.collie` file, but the React component replacement is `<Collie id="..." />` with **no props passed**, so runtime values are undefined.
* Also, if you want `{viteLogo}` style (without `props.`), the `.collie` file must contain a `props` block declaring them.

**What to do**

1. During conversion:

   * Analyze the TSX selection and collect **identifiers used in JSX expression contexts** (`{viteLogo}`, `{reactLogo}`, `{count}`, etc.)
2. Replace selected TSX with:

   * `<Collie id="X" viteLogo={viteLogo} reactLogo={reactLogo} ... />`
3. Generate or update the `.collie` template block for `#id X`:

   * Create a `props` block under the id (default type `any`/`unknown`)
   * Merge new props if the block already exists (do not duplicate, do not overwrite)

**Where**

* Conversion pipeline: `src/features/conversion/*`
* TSX parsing helpers: `src/convert/tsx/*`
* Collie file writer: wherever it creates/appends template blocks

**Expected behavior**

* Selecting TSX:

  ```tsx
  <img src={viteLogo} />
  <img src={reactLogo} />
  ```

  produces:

  * TSX:

    ```tsx
    <Collie id="App.App" viteLogo={viteLogo} reactLogo={reactLogo} />
    ```
  * Collie:

    ```collie
    #id App.App

    props
      viteLogo: any
      reactLogo: any

    ...
    img.logo(src={viteLogo})
    img.logo.react(src={reactLogo})
    ```

---

### Stage V6 — Diagnostics: bring back “template id declared but not referenced” warning (but NOT HTML-placeholder-only)

**Problem**

* You killed COLLIE404 because it was wrong in Vite/framework projects.
* But now you want a warning when a `#id` exists but is never mounted anywhere (neither HTML placeholder nor `<Collie id="...">`).

**What to do**

* Implement a general “unreferenced template id” warning:

  * A template id is considered referenced if it appears in either:

    * HTML placeholder (if you still support that), OR
    * `<Collie id="...">` usage in TS/JS/TSX/JSX
* Do **not** bring back the vanilla-only placeholder message. Make this warning neutral and accurate in all project types.

**Where**

* Add a usage index to scan for `<Collie id="...">` (regex scan is fine).
* Diagnostics provider: the central place that collects semantic warnings for `.collie`.

**Expected behavior**

* If `#id App1` exists and nothing references it:

  * show warning: “Template id ‘App1’ is not referenced…”
* If it’s referenced by `<Collie id="App1" />`:

  * no warning
