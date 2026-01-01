## Context & End Goal

We want the VS Code extension to deliver **professional diagnostics + fixes** without becoming a resource hog:

* Read Collie config and gate expensive features (especially CSS scanning).
* Surface compiler diagnostics (dialect + props) with code actions.
* Only build a CSS class index when config indicates it’s valuable (`css.strategy="global"` and unknown-class rule enabled), and only when a `.collie` file is open.
* Later, optionally add TS-based cross-file prop checks behind an explicit flag.

---

### Stage 1 — Config discovery + caching + feature gating

**Work to do**

1. Implement config discovery for a `.collie` file:

   * Find nearest `collie.config.*` (whatever the Collie repo supports) by walking up directories.
   * Cache the resolved result per workspace folder (and/or per config path).
   * Invalidate cache when the config file changes.
2. Parse only the fields the extension needs:

   * `css.strategy`
   * `css.diagnostics.unknownClass`
   * `dialect` (only if you plan extension-side enforcement; preferred path is compiler emits diagnostics)
   * `dialect.props` (only if extension-side enforcement; preferred path is compiler emits diagnostics)
3. Compute feature flags from config:

   * `enableCssIndex` should be true only when:

     * `css.strategy === "global"` AND `unknownClass` not `"off"`
   * Tailwind: ensure unknown-class diagnostics are disabled and CSS index not built.
   * Unknown: keep CSS diagnostics off by default.
4. Ensure this gating happens before any indexing or background watchers are started.

**Acceptance criteria**

* Extension does not start CSS watchers/indexing in Tailwind projects.
* Opening a `.collie` file in a global-css project enables CSS-related features (if configured).
* Config changes take effect without reload (or with minimal prompt if required).

#### Complete: 0%

### Notes

* Prefer lazy behavior: do nothing until a `.collie` file is opened.

---

### Stage 2 — Compiler diagnostics integration (dialect + props) in editor

**Work to do**

1. Decide the integration path:

   * Preferred: invoke Collie compiler/analyzer to produce diagnostics for the open document.
   * If a language server exists, consume LSP diagnostics.
   * Avoid re-implementing parsing rules in the extension if the compiler can do it.
2. Map compiler diagnostics to VS Code diagnostics:

   * severity mapping
   * range mapping
   * include diagnostic code
3. Ensure diagnostics update on:

   * document change (debounced)
   * document save
   * config change (invalidate and re-run)
4. Ensure this path is fast and only runs for open `.collie` files (and optionally recently edited ones).

**Acceptance criteria**

* Dialect token diagnostics appear in-editor with the correct severity and message.
* Props intra-file diagnostics appear in-editor.
* No significant CPU spikes while typing (use debounce).

#### Complete: 0%

### Notes

* If you can’t invoke compiler directly, you may temporarily implement minimal analyzers, but keep them scoped and plan to replace with compiler diagnostics.

---

### Stage 3 — Code actions for dialect + props fixes

**Work to do**

1. Implement Code Actions that trigger from diagnostics payload metadata:

   * If diagnostic includes `{ fix: { range, replacementText } }`, provide “Apply fix”.
   * If diagnostic includes `{ data: { kind: "addPropDeclaration", propName } }`, implement insertion into `props` block:

     * If `props` block exists, add line in correct indentation.
     * If missing, create `props` block near top in canonical location.
2. Add actions:

   * “Convert to preferred token spelling” (from dialect diagnostics)
   * “Add missing prop to props block”
   * “Remove unused prop declaration” (only if compiler supplies a safe removal range)

**Acceptance criteria**

* Users can apply preferred token fixes with one click.
* Missing prop declarations can be inserted reliably.
* Actions are fast and don’t require workspace indexing.

#### Complete: 0%

### Notes

* Be conservative about fixes that could change semantics (e.g., rewriting `props.foo` to `foo`).

---

### Stage 4 — CSS class index (global CSS only, lazy + incremental)

**Work to do**

1. Implement a CSS class selector indexer that only activates when:

   * `enableCssIndex === true` AND
   * a `.collie` file is open (or the user explicitly runs a command)
2. Index files based on configurable globs (provide defaults):

   * include: `**/*.{css,scss,sass,less}`
   * exclude: `**/node_modules/**`, `**/dist/**`, `**/build/**`
3. Extract class selectors conservatively:

   * parse `.foo` occurrences in selectors
   * handle `.foo:hover`, `.foo.bar`, `.foo .bar`
   * support `:global(.foo)` patterns if simple to detect
4. Maintain in-memory map:

   * className → list of definition locations (URI + range)
5. Update index incrementally:

   * watch CSS file changes (debounced)
   * re-index only changed file
6. Add performance guardrails:

   * cap total indexed files and/or total bytes
   * skip files above a threshold size unless configured
   * ensure watchers are not active when CSS index is disabled

**Acceptance criteria**

* In global CSS projects, unknown class diagnostics can be computed using the index.
* Indexing does not run in Tailwind projects.
* Indexing is incremental and does not freeze VS Code.

#### Complete: 0%

### Notes

* If class extraction becomes complex, start with a regex-based extractor and improve later; keep it conservative.

---

### Stage 5 — Unknown class diagnostics in Collie templates (global CSS only)

**Work to do**

1. Extract class segments from Collie markup for the open document:

   * `div.foo.bar` yields segments `foo`, `bar`
   * If you have class alias expansion in Collie (implicit via `classes` block), do NOT treat alias keys as unknown classes; treat their expanded segments (if you can access them). If you cannot access expansions from the extension, limit this rule to literal segments only.
2. For each literal class segment:

   * If class exists in CSS index → ok
   * Else → emit `css.unknownClass` diagnostic with severity from config
3. Add “Go to definition(s)” / “Peek definitions” if definitions exist:

   * Provide a command or a definition provider based on the CSS index.

**Acceptance criteria**

* Unknown class warnings appear only in global CSS mode.
* Tailwind mode produces no unknown-class noise.
* Navigation to CSS definitions works for known classes.

#### Complete: 0%

### Notes

* If Collie uses dot-separated class lists that compile to space-separated className, ensure extraction matches Collie’s semantics.

---

### Stage 6 — Commands and observability (keeps teams happy)

**Work to do**

1. Add commands:

   * “Collie: Rebuild CSS Index”
   * “Collie: Show Current Config (for this file)”
   * “Collie: Toggle CSS Unknown Class Diagnostics” (optional quick toggle; persists in workspace settings or respects config)
2. Add lightweight logging behind a debug flag to help troubleshoot performance:

   * time spent indexing
   * number of files indexed
   * whether features were gated off due to Tailwind strategy

**Acceptance criteria**

* Users can manually rebuild index if needed.
* Debugging performance issues is possible without flooding logs by default.

#### Complete: 0%

### Notes

* Keep logging default-off.

---

### Stage 7 — (Optional) TypeScript-based cross-file prop checks (behind explicit flag)

**Work to do**

1. Add config flag support (read from Collie config or VS Code settings):

   * `props.reactIntegration.enabled` default false
2. If enabled, implement TS-based analysis:

   * Resolve the generated TSX component symbol
   * Find JSX usage sites where props are passed
   * Compare:

     * passed props vs props used in Collie component
     * props used vs props type (if available)
3. Emit low severity diagnostics first (info/warn) due to possible uncertainty.

**Acceptance criteria**

* Feature is off by default.
* When enabled, produces useful hints without becoming a CPU hog.

#### Complete: 0%

### Notes

* Only run analysis for currently open Collie file (not the entire workspace).
* Debounce and cache results heavily.
