# Contributing to Collie VS Code Extension

## Code Organization Guidelines

This codebase follows a structured organization pattern to keep code maintainable and navigable as it grows.

### Core Principles

1. **Types live next to the domain that owns them**, not in a global bucket.
   - ✅ `features/semanticTokens/types.ts`
   - ❌ `src/types.ts`

2. **Helpers are split by "reason to change," not by file that used to contain them.**
   - Example: Range conversion helpers in diagnostics live in `helpers/ranges.ts`, not scattered in `provider.ts`

3. **Keep public entrypoints stable**:
   - Use `index.ts` barrel exports for modules people import
   - Keep `src/extension.ts` and `src/features/index.ts` thin and focused on orchestration

4. **Never create a helper file that's just a dumping ground.**
   - If `helpers.ts` in a folder starts getting big, split it into `helpers/<topic>.ts`

### File Structure Pattern

Each major module should follow this structure:

```
src/features/myFeature/
├── index.ts           # Public API / orchestration (thin)
├── types.ts           # Type definitions for this feature
├── helpers.ts         # Simple helpers (split when it grows)
└── helpers/           # Split helpers by concern
    ├── cache.ts
    ├── parsing.ts
    └── validation.ts
```

### When to Create New Files

**Create a new `types.ts` when:**
- You have 3+ interfaces/types specific to a module
- Types are imported by multiple files in the module

**Create a `helpers/` folder when:**
- `helpers.ts` exceeds ~150 lines
- You have distinct helper categories (parsing, validation, formatting, etc.)
- Helpers have different dependencies/concerns

**Create a new module folder when:**
- A single file exceeds ~500 lines
- Related functionality can be grouped with clear boundaries
- The feature has distinct sub-concerns (e.g., `parser/` with lexer, AST, printer)

### Shared Utilities

Use the `src/shared/` folder for truly cross-cutting concerns:

- **`shared/helpers/uri.ts`**: URI/document key helpers
- **`shared/helpers/debounce.ts`**: Debouncing utilities
- **`shared/helpers/regex.ts`**: Safe regex execution helpers
- **`shared/helpers/text.ts`**: String manipulation
- **`shared/helpers/vscodeRanges.ts`**: VS Code Range utilities

### Anti-Patterns to Avoid

❌ **Don't create `utils.ts` or `common.ts`** - These become dumping grounds. Be specific about what helpers do.

❌ **Don't duplicate helper logic** - If you find yourself copying a helper, move it to `shared/helpers/`

❌ **Don't create circular dependencies** - If module A imports module B, module B should never import module A

❌ **Don't leak implementation details** - Keep internal helpers internal, only export what's needed

### Best Practices

✅ **Use compatibility shims for major refactors**
- When moving code, keep a thin re-export at the old location temporarily
- Example: `src/logger.ts` re-exports from `src/core/logger/`

✅ **Use the shared helpers for common patterns**
- URI keys: Use `getDocumentKey()` from `shared/helpers/uri.ts`
- Debouncing: Use `DebouncedMap` from `shared/helpers/debounce.ts`
- Regex: Use `execPattern()` from `shared/helpers/regex.ts` to avoid lastIndex bugs

✅ **Keep orchestration separate from implementation**
- Main files should read like a story (what happens)
- Helpers should contain the details (how it happens)

✅ **Document non-obvious decisions**
- Add comments explaining "why" when the "what" isn't obvious
- Document performance considerations in hot paths

## Building and Testing

```bash
# Install dependencies
pnpm install

# Build extension
pnpm build

# Watch mode for development
pnpm watch

# Run the extension (F5 in VS Code)
# Opens Extension Development Host
```

## Making Changes

1. Follow the file structure patterns above
2. Keep files focused and under ~500 lines
3. Extract helpers when needed
4. Run `pnpm build` to verify
5. Test in Extension Development Host

## Questions?

When in doubt:
- Look at recently refactored modules (e.g., `features/semanticTokens/`, `format/parser/`)
- Check `plans/refactor/v1.md` for architectural decisions
- Keep it simple - don't over-engineer
