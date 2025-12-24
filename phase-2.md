# 🎯 Stage 4 — HTML ↔ Collie Navigation & Editor Intelligence

**Scope:**
All work in this file applies to the **collie-vscode** repo only.

**Hard constraints (do not violate):**

* Do **NOT** move, delete, or rename files.
* Do **NOT** perform “cleanup” refactors unless explicitly instructed.
* Only implement what is described for the requested sub-stage.
* Always build on the existing ID/index infrastructure from Stages 1–3 (ID parsing, ID index, HTML anchor index, etc.).

This stage is split into **6 sub-stages**.
Each sub-stage is safe to ask for independently.

---

## 4.1 — Shared Navigation Utilities

### 🎯 Goal

Centralize helper functions that map between:

* **Template IDs ↔ Collie documents**
* **Template IDs ↔ HTML anchors**

…so the later features (Go to Definition, command, completions, symbols) don’t duplicate logic or drift.

### Files to touch

* `src/lang/...`

  * Wherever the **ID index** and **HTML anchor index** live (from Stages 2–3).
    Likely something like:

    * `src/lang/idIndex.ts` (or similar)
    * `src/lang/cache.ts`
* `src/lang/navigation.ts` (create **only if it doesn’t exist**; otherwise extend an existing suitable module)

### Implementation steps

1. **Inspect the existing ID index API**

   * Identify the exported getters that let you:

     * Retrieve **all template entries**.
     * Retrieve template(s) by **logical ID**.
   * Do **not** refactor the index itself, just build on top of it.

2. **Inspect the existing HTML anchor index API**

   * Identify where HTML file scanning is implemented (from Stage 3).
   * Identify functions that map logical IDs to HTML files containing `<id>-collie`.

3. **Add navigation helper module (or extend one)**

   * In `src/lang/navigation.ts` or a similar `lang` file, expose type-safe helpers:

     ```ts
     export interface TemplateMatch {
       id: string;
       uri: vscode.Uri;
       idSpan?: SourceSpan;
       derivedFromFilename: boolean;
     }

     export interface HtmlAnchorMatch {
       id: string;          // logical ID
       uri: vscode.Uri;
       ranges: vscode.Range[]; // locations of id="<id>-collie"
     }

     export function findTemplatesByLogicalId(id: string): TemplateMatch[];

     export function findHtmlAnchorsByLogicalId(id: string): HtmlAnchorMatch[];

     export function getLogicalIdFromHtmlIdAttribute(raw: string): string | undefined;
     // e.g. "homeHero-collie" -> "homeHero"
     ```

   * `getLogicalIdFromHtmlIdAttribute` should:

     * Accept the string inside the HTML `id=` value.
     * Return the logical template ID if the value matches `<id>-collie`.
     * Return `undefined` otherwise.

4. **Wire helpers to indices**

   * Implement `findTemplatesByLogicalId` by delegating to the existing template ID index.
   * Implement `findHtmlAnchorsByLogicalId` by delegating to the existing HTML anchor index.

5. **Do not add any VS Code registrations yet**

   * This sub-stage is purely about **shared utilities**.
     No commands, providers, or registrations should be added here.

### ✔️ Acceptance criteria

* There is a small, focused set of navigation helpers that:

  * Map from logical ID → Collie templates.
  * Map from logical ID → HTML anchors.
  * Extract logical ID from HTML `id` strings like `"homeHero-collie"`.
* No new diagnostics, commands, or providers are registered yet.
* Existing ID/HTML indices are **not** refactored or relocated.

---

## 4.2 — Go to Definition: HTML → Collie

### 🎯 Goal

From HTML files, allow users to **Cmd/Ctrl+Click** on `id="homeHero-collie"` and jump to the matching Collie template(s) with logical ID `homeHero`.

### Files to touch

* `src/features/definition/...`

  * If there is an existing definition provider, extend it.
  * Otherwise, create a new module, e.g. `src/features/definition/htmlToCollieDefinitionProvider.ts`.
* `src/extension.ts` (or the main activation module)

  * For provider registration.
* The shared navigation helpers from **4.1**.

### Implementation steps

1. **Create HTML → Collie definition provider**

   * Implement a `DefinitionProvider` for HTML documents:

     ```ts
     class CollieHtmlToCollieDefinitionProvider implements vscode.DefinitionProvider {
       provideDefinition(
         document: vscode.TextDocument,
         position: vscode.Position,
         token: vscode.CancellationToken
       ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
         // Implementation
       }
     }
     ```

2. **Detect when the cursor is on an HTML id attribute**

   * Within `provideDefinition`:

     * Confirm `document.languageId` is `html` (or other relevant HTML-like IDs if you already support more).
     * Locate the attribute under the cursor:

       * Look for patterns like `id="..."`
       * Use either:

         * A simple regex on the current line, or
         * A more robust HTML AST if you already have one (don’t introduce a new heavy dependency).
     * Extract the attribute **value string** (e.g., `homeHero-collie`).

3. **Map HTML id value → logical template ID**

   * Use `getLogicalIdFromHtmlIdAttribute` from **4.1**:

     * If it returns `undefined`, **bail early** (no definition).
     * If it returns a logical ID (e.g., `"homeHero"`), proceed.

4. **Lookup Collie templates**

   * Call `findTemplatesByLogicalId(logicalId)` from **4.1**.
   * If no templates are found:

     * Return `undefined` (no definition).
   * If one or more templates are found:

     * For each:

       * Create a `DefinitionLink` targeting:

         * The template document.
         * The `idSpan` (if explicit) or a reasonable fallback (e.g., first line) if implicit.

5. **Register the provider**

   * In `extension.ts` (or equivalent), register the provider for HTML:

     ```ts
     context.subscriptions.push(
       vscode.languages.registerDefinitionProvider(
         { language: 'html', scheme: 'file' },
         new CollieHtmlToCollieDefinitionProvider()
       )
     );
     ```

   * Do not interfere with existing Collie-specific definition providers.

### ✔️ Acceptance criteria

* In an HTML file, placing the cursor on `homeHero-collie` inside `id="homeHero-collie"` and invoking “Go to Definition”:

  * Jumps to the matching `.collie` file for `homeHero`.
  * Goes to the `id` directive span if explicit; otherwise, the top of file or a reasonable fallback.
* If multiple templates share the same logical ID (should be rare due to diagnostics):

  * VS Code presents a selection of destinations (standard `DefinitionLink` behavior).
* Non-`*-collie` ids do **not** trigger Collie definitions.

---

## 4.3 — Go to Definition: Collie → HTML

### 🎯 Goal

From a `.collie` file, allow Cmd/Ctrl+Click on the `id` directive value (e.g., `homeHero`) to jump to the corresponding HTML anchors with `id="homeHero-collie"`.

### Files to touch

* `src/features/definition/...`

  * Extend the existing Collie definition provider, or add a parallel one.
* `src/extension.ts` (if additional registration is needed).
* Navigation helpers from **4.1**.

### Implementation steps

1. **Extend or create Collie definition provider**

   * In an appropriate file (`src/features/definition/collieDefinitionProvider.ts` or similar), implement logic for `.collie` documents in `provideDefinition`:

     ```ts
     if (document.languageId === 'collie') {
       // handle id directive
     }
     ```

2. **Detect cursor on the ID directive value**

   * Use the internal parser/AST (from Stage 1) to:

     * Retrieve the `RootNode` for the file.
     * Access `RootNode.idSpan` (the span covering the ID value).
   * Convert `idSpan` to a `vscode.Range` and check whether the current `position` is within that range.
   * If not on the ID directive value, **do nothing** and fall back to any existing behavior (tags, props, etc.).

3. **Lookup HTML anchors**

   * If on ID value:

     * Get the logical ID from the AST (`RootNode.id`).
     * Call `findHtmlAnchorsByLogicalId(logicalId)` from **4.1**.
     * If no anchors:

       * Return `undefined` (no definition).
     * If anchors exist:

       * For each anchor:

         * Create a `DefinitionLink` targeting:

           * The HTML document.
           * The range(s) corresponding to `homeHero-collie` inside `id="..."`.

4. **Registration**

   * Make sure the Collie definition provider is registered for the `collie` language only.
   * Do not change any HTML registration from **4.2**.

### ✔️ Acceptance criteria

* In a `.collie` file, Cmd/Ctrl+Click on the ID value (`homeHero`) jumps to one or more HTML files containing `id="homeHero-collie"`.
* Multiple anchors (across files or within the same file) are presented as multiple definition locations via standard VS Code UI.
* Clicking elsewhere in the file (tags, props, etc.) continues to use existing behavior (if any), and does not break.

---

## 4.4 — Command: “Open Compiled HTML Partial”

### 🎯 Goal

Add a VS Code command that, from a `.collie` file, opens the corresponding compiled HTML partial at `/collie/dist/<id>.html` in the workspace (if present).

### Files to touch

* `src/features/commands/...`

  * Add or extend a module, e.g. `src/features/commands/openCompiledHtmlPartial.ts`.
* `src/extension.ts`

  * Register the command.
* Any existing configuration/utilities for resolving workspace root paths.

### Implementation steps

1. **Define the command ID**

   * Decide on a command ID (and add it to `package.json` command contributions later, if not already there):

     ```json
     "collie.openCompiledHtmlPartial"
     ```

2. **Implement the command handler**

   * In the commands module:

     ```ts
     export function registerOpenCompiledHtmlPartialCommand(context: vscode.ExtensionContext) {
       const disposable = vscode.commands.registerCommand(
         'collie.openCompiledHtmlPartial',
         async () => {
           // handler
         }
       );
       context.subscriptions.push(disposable);
     }
     ```

3. **Handler behavior**

   * Steps inside the handler:

     1. Get the active editor; if none or not a `.collie` document, show a warning and exit.
     2. Use the internal AST for the active document to get the logical ID (`RootNode.id` or derived from filename).
     3. Construct the expected path:

        * `collie/dist/<id>.html` relative to the workspace root.
        * Support multiple workspace folders if necessary; pick the folder where the `.collie` file lives.
     4. Check if the file exists via `vscode.workspace.fs.stat`.
     5. If it exists:

        * Open it via `vscode.workspace.openTextDocument` and `vscode.window.showTextDocument`.
     6. If it does **not** exist:

        * Show a notification:

          > `No compiled HTML partial found at "collie/dist/<id>.html" for template id "<id>".`

4. **Register the command**

   * In `extension.ts`, call `registerOpenCompiledHtmlPartialCommand(context)` during activation.
   * Add the command to `package.json` contributions if needed (title, category “Collie”).

### ✔️ Acceptance criteria

* When in a `.collie` file, invoking `Collie: Open compiled HTML partial`:

  * Opens `collie/dist/<id>.html` if it exists.
  * Shows a clear, non-crashy notification if it does not.
* Command has no effect (other than a friendly message) if not called from a Collie file.

---

## 4.5 — HTML Completions for `*-collie` IDs

### 🎯 Goal

While editing HTML, provide completions for `id="...-collie"` values based on known Collie template IDs in the workspace.

### Files to touch

* `src/features/completion/...`

  * Implement a completion provider for HTML, or extend an existing one.
* `src/extension.ts`

### Implementation steps

1. **Create HTML completion provider**

   * Implement a `CompletionItemProvider` for HTML:

     ```ts
     class CollieHtmlIdCompletionProvider implements vscode.CompletionItemProvider {
       provideCompletionItems(
         document: vscode.TextDocument,
         position: vscode.Position,
         token: vscode.CancellationToken,
         context: vscode.CompletionContext
       ): vscode.ProviderResult<vscode.CompletionItem[]> {
         // implementation
       }
     }
     ```

2. **Detect `id="..."` context**

   * Only offer completions when:

     * The cursor is inside an `id` attribute value.
     * E.g., `id="|"` or `id="home|"` (where `|` is cursor).
   * Use:

     * Simple line-based parsing, or
     * Existing HTML parsing helpers if available.

3. **Generate completion items from template IDs**

   * Use the template ID index from Stage 2 to fetch all known logical IDs.
   * For each logical ID `id`:

     * Suggest `id-collie` as the **attribute value**.
   * Create completion items:

     ```ts
     const item = new vscode.CompletionItem(
       `${id}-collie`,
       vscode.CompletionItemKind.Value
     );
     item.insertText = `${id}-collie`;
     item.detail = 'Collie template placeholder';
     item.documentation = new vscode.MarkdownString(
       `Placeholder for Collie template \`${id}\`.\n\nThe runtime will fetch \`/collie/dist/${id}.html\`.`
     );
     ```

4. **Register the completion provider**

   * In `extension.ts`, register it for HTML:

     ```ts
     context.subscriptions.push(
       vscode.languages.registerCompletionItemProvider(
         { language: 'html', scheme: 'file' },
         new CollieHtmlIdCompletionProvider(),
         '"', // trigger characters (optional)
         '-'  // you can also use '-' if you want
       )
     );
     ```

### ✔️ Acceptance criteria

* Inside an HTML `id="..."` attribute, when the user types, completions appear for `<templateId>-collie` for all known template IDs.
* Selecting a completion inserts `<templateId>-collie` as the value.
* Completions are **not** offered outside `id="..."` contexts.

---

## 4.6 — Workspace Symbols for Collie Templates

### 🎯 Goal

Expose Collie templates as **workspace symbols**, so users can jump to them via `Go to Symbol in Workspace` (Cmd/Ctrl+T).

### Files to touch

* `src/features/symbols/...`

  * Implement a workspace symbol provider if none exists.
* `src/extension.ts`
* Template ID index / AST access utilities.

### Implementation steps

1. **Implement `WorkspaceSymbolProvider`**

   * Create something like `src/features/symbols/collieWorkspaceSymbolProvider.ts`:

     ```ts
     class CollieWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
       provideWorkspaceSymbols(
         query: string,
         token: vscode.CancellationToken
       ): vscode.ProviderResult<vscode.SymbolInformation[]> {
         // implementation
       }
     }
     ```

2. **Build symbol list from ID index**

   * Use the template ID index from Stage 2:

     * For each template entry:

       * Use logical ID as the symbol name.
       * Use the template file URI.
       * Use the `idSpan` (if available) as the symbol location; otherwise top-of-file.

   * Optional: simple query filtering:

     * If `query` is non-empty, include only templates whose ID includes the query substring (case-insensitive).

   * Example symbol:

     ```ts
     new vscode.SymbolInformation(
       entry.id,
       vscode.SymbolKind.Class, // or Function / Object — any consistent choice
       path.basename(entry.uri.fsPath),
       new vscode.Location(entry.uri, range)
     );
     ```

3. **Register the provider**

   * In `extension.ts`, register:

     ```ts
     context.subscriptions.push(
       vscode.languages.registerWorkspaceSymbolProvider(
         new CollieWorkspaceSymbolProvider()
       )
     );
     ```

4. **(Optional) File-outline-level symbols**

   * Only if cheap and non-invasive:

     * Inside file-level `DocumentSymbolProvider` (if one exists), add:

       * `id` directive symbol.
       * `props` block symbol.
       * `classes` block symbol.

### ✔️ Acceptance criteria

* `Go to Symbol in Workspace` shows Collie template IDs as entries.
* Selecting a Collie symbol jumps to the correct `.collie` file and location.
* Query filtering works (typing part of an ID filters symbols).
