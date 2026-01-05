## Context & Problem

You are working in the `collie-vscode` repo (VS Code extension). The TSX → Collie conversion writes a `#props` block in the generated `.collie` output. We recently changed the output format so **callable props** are indicated with trailing parentheses:

```collie
#props
  setCount()
  count
```

This is purely declarative in the `#props` directive (it must NOT imply invocation). It’s a visual cue only.

However, the current implementation is **incorrectly marking locally-bound identifiers as props** when they appear in callback parameters, especially in common React patterns like:

```ts
setCount((count) => count + 1)
```

This causes the generated `#props` to incorrectly include `count()` even though `count` is a value prop/free var, not a function prop.

Example of current wrong output:

```collie
#props
  setCount()
  count()
```

Expected:

```collie
#props
  setCount()
  count
```

### Root cause (likely)

The identifier collection logic that infers props and “callable vs value” is walking the TypeScript AST of expression text but is **not scope-aware**. It treats identifiers introduced by parameters / bindings inside the expression (e.g., arrow function params) as if they were free variables/props.

### Goal

Fix the prop inference logic so it is **scope-aware** and does not treat locally-bound names as props. Keep the `()` formatting for callable props. Ensure language parsing + semantic tokens still support and highlight the new syntax.

---

## What to implement

### 1) Scope-aware identifier collection (core fix)

Find where the conversion pipeline parses TS/JS expressions with the TS compiler API and collects identifiers to populate `#props` and determine prop kind (`fn` vs `value`). This is likely in one of:

* `src/features/conversion/*` (e.g. `convertSelectionCommand.ts`, `imports.ts`, helpers)
* Any existing “collect identifiers from expression text” function

Update the AST walk to track local bindings introduced inside the expression, so **only free identifiers** are considered props.

#### Binding sources to handle (minimum required)

Treat the following identifiers as **bound** and therefore excluded from “prop candidates” when encountered later in their scope:

* Arrow function parameters:

  * `(count) => count + 1`
  * `count => count + 1`
  * `([count, setCount]) => ...`
  * `({ count }) => ...`
* Function expression parameters:

  * `function (count) { ... }`
* Catch clause parameter (rare but cheap to support):

  * `try { ... } catch (e) { ... }`
* Variable declarations inside expression text (rare but support if simple):

  * `(() => { const x = 1; return x; })()`

#### Notes

* Use a scope stack: `Array<Set<string>>`.
* Add a helper to extract bound identifiers from TS binding patterns:

  * `Identifier`
  * `ObjectBindingPattern`
  * `ArrayBindingPattern`
  * `BindingElement`
* When visiting an `Identifier`, only treat it as a prop candidate if it is **not bound** in any current scope.

#### Important: don’t count property names

When seeing `obj.foo`, don’t treat `foo` as a prop identifier. Only consider `obj` (if free).

---

### 2) Callable-vs-value inference (keep behavior, but avoid false positives)

Callable props should be output as `name()` in `#props`. Value props should be `name` (no parens).

Maintain/implement these heuristics:

**Mark identifier as callable (`fn`) if:**

* It is the callee of a `CallExpression` / `NewExpression`:

  * `setCount(...)`
  * `fnRef.current(...)` should NOT mark `current` etc; only identifiers that are actual callee identifiers
* It is used as a bare identifier in an event handler assignment context:

  * `onClick={setCount}` ⇒ `setCount()` should be emitted
  * Apply this when you have access to the JSX attribute name (e.g., `onClick`, `onChange`, etc.)
  * Consider any prop name matching `^on[A-Z]` or `^on[a-z]` as “event-like”

**Mark identifier as value if:**

* It is referenced free (e.g., `{{ count }}`, `{count}`, `count + 1`), but never meets callable conditions.

**If unsure:** default to value.

---

### 3) Emission in `#props`

Ensure the prop writer emits:

* `name()` for callable props
* `name` for value props

Keep stable ordering:

* If existing behavior preserves discovery order, keep it.
* If order is currently unstable, sort alphabetically (but be consistent).

No fake TypeScript types should appear in the output (`: any`, `: fn`, etc.).

---

### 4) Parser and semantic tokens compatibility

Because `#props` is now `name` / `name()`, update any related parsing/tokenization so it recognizes:

* `foo`
* `foo()`

Also keep backward compatibility (accept legacy input) if it exists:

* `foo: any`
* `foo: fn`

…but do not emit them.

#### Files likely involved:

* `src/lang/parseDocument.ts` (parsing directives / props)
* `src/features/semanticTokens/*` (regex patterns + tokenizer + legend)

#### Semantic token requirement

There must be a distinct semantic token type for function props in the `#props` block (so theme colors can differ):

* Existing token type should continue for value props (or keep current behavior).
* Add a NEW token type for function props and register it in the legend/provider.

At the end, print a short summary with:

* the new semantic token type name (exact string)
* where it’s registered

---

## Acceptance Criteria

### Core correctness

Given this TSX:

```tsx
const [count, setCount] = useState(0);

<button onClick={() => setCount((count) => count + 1)}>
  {count}
</button>
```

Expected `#props` includes:

* `setCount()` (callable)
* `count` (value)
  AND MUST NOT include `count()`.

### Edge cases (must pass)

1. Callback param shadowing (ignore the param name):

```tsx
onClick={() => setCount((count) => count + 1)}
```

* `count` param inside inner arrow must not affect props inference.

2. Different param name (still correct):

```tsx
onClick={() => setCount((prev) => prev + 1)}
```

* still: `setCount()` and `count` (value if referenced elsewhere), and no `prev` in props.

3. Bare handler reference (should be callable):

```tsx
<button onClick={setCount} />
```

* `setCount()` should be emitted.

4. Property access shouldn’t create fake props:

```tsx
<div>{props.count}</div>
```

* don’t add `count` as a prop; only consider `props` if your system treats it as a prop (prefer ignoring `props` too if it’s known local/imported).

5. Destructured binding in callback params (ignore bound names):

```tsx
items.map(({ count }) => count + 1)
```

* do not add `count` from that destructuring as a prop.

6. Interpolation reference should mark value:

```collie
{{ count }}
```

* `count` must remain value prop, not callable.

### Semantic token behavior

* In a `.collie` file, within the `#props` block:

  * `setCount` in `setCount()` uses the NEW function-prop semantic token type
  * `count` uses the existing value-prop token type
* The semantic token inspector in VS Code should show the new token type.

### Build hygiene

* `pnpm lint` and `pnpm build` (or the repo equivalents) must pass.
* Do not introduce circular imports.

---

## Do NOT write tests

No unit tests, no integration tests, no snapshots.

---

## Output request

After completing the changes, provide a brief summary:

* Files modified
* New semantic token type name for function props in `#props`
* Any user-facing behavior changes (one paragraph max)
