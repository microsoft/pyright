# Copilot Instructions for Pyright

Pyright is a static type checker for Python, written in TypeScript. It ships as an npm CLI (`pyright`), an LSP language server (`pyright-langserver`), and a VS Code extension (`vscode-pyright`).

## Build and Test

```bash
# Install all packages (from repo root)
npm install

# Build the core library
cd packages/pyright-internal && npm run build

# Run all tests (builds test server first)
cd packages/pyright-internal && npm test

# Run all tests without rebuilding the test server (faster iteration)
cd packages/pyright-internal && npm run test:norebuild

# Run a single test file
cd packages/pyright-internal && npx jest typeEvaluator1.test --forceExit

# Run a single test by name
cd packages/pyright-internal && npx jest -t "Generic1" --forceExit

# Build the CLI (webpack bundle)
npm run build:cli:dev

# Build the VS Code extension (webpack bundle)
npm run build:extension:dev
```

### Linting

```bash
# Run all checks (syncpack + eslint + prettier)
npm run check

# Individual checks
npm run check:eslint
npm run check:prettier

# Auto-fix
npm run fix:eslint
npm run fix:prettier
```

## Architecture

### Package Structure

- **`packages/pyright-internal`** — Core library: parser, binder, type evaluator, checker, language service. All logic lives here. This is the only package with tests.
- **`packages/pyright`** — CLI wrapper. Webpack-bundles `pyright-internal` into a distributable npm package with `pyright` and `pyright-langserver` entry points.
- **`packages/vscode-pyright`** — VS Code extension client that communicates with the language server.

### Analysis Pipeline

Source files are processed through these phases in order:

1. **Tokenizer** (`parser/tokenizer.ts`) — text → token stream
2. **Parser** (`parser/parser.ts`) — tokens → parse tree (AST)
3. **Binder** (`analyzer/binder.ts`) — builds scopes, symbol tables, and reverse code flow graphs
4. **Checker** (`analyzer/checker.ts`) — walks every node, triggering type evaluation and reporting diagnostics
5. **Type Evaluator** (`analyzer/typeEvaluator.ts`) — performs type inference, constraint solving, type narrowing, and overload resolution

### Key Design Patterns

**Type Evaluator closure pattern**: `typeEvaluator.ts` uses a single large `createTypeEvaluator()` factory function. Internal methods access the full closure for performance (same approach as the TypeScript compiler). The public API is defined as the `TypeEvaluator` interface in `typeEvaluatorTypes.ts`.

**Service → Program → SourceFile**: A `Service` manages a `Program`, which tracks `SourceFile` instances. The `Program` coordinates analysis ordering, prioritizing open editor files and their dependencies.

**Typeshed fallback**: `packages/pyright-internal/typeshed-fallback/` contains a bundled copy of typeshed stubs. This provides the Python stdlib type stubs when no external typeshed is available.

**Localized diagnostics**: All user-facing diagnostic messages come from `localization/localize.ts`, not inline strings.

## Test Conventions

### Test Structure

Tests live in `packages/pyright-internal/src/tests/`. There are two main patterns:

**Sample-based tests** (`typeEvaluator*.test.ts`, `checker.test.ts`):
- Each test calls `TestUtils.typeAnalyzeSampleFiles(['sampleName.py'])` to analyze a Python file from `src/tests/samples/`.
- Results are validated with `TestUtils.validateResults(results, errorCount, warningCount, infoCount, unusedCode, unreachableCode, deprecated)`.
- Sample `.py` files use comments like `# This should generate an error` to document expected diagnostics, but the actual assertion is the count passed to `validateResults`.

**Fourslash tests** (`src/tests/fourslash/`):
- Simulate LSP interactions (completions, hover, go-to-definition, rename, etc.).
- Use `// @filename:` markers to define virtual files and `///` prefix for embedded Python content.

### Adding a Test

1. Create a `.py` sample file in `src/tests/samples/` following the naming pattern (e.g., `newFeature1.py`).
2. Add a test case in the appropriate `*.test.ts` file calling `typeAnalyzeSampleFiles` and `validateResults`.
3. Test files are split across `typeEvaluator1.test.ts` through `typeEvaluator8.test.ts` for parallel execution.

### Test Policy

Tests are the specification for Pyright behavior. Never modify tests just to make CI pass. Any change that makes types less precise (e.g., `T → Unknown`, `list[int] → list[Any]`, `Literal["x"] → str`) is a regression by default and requires explicit justification. See `.github/agents/pyright-test-policy.md` for details.

## Code Style

- **Formatting**: Prettier with 4-space indentation, single quotes, 120-char print width.
- **Private members**: Must have leading underscore (`_privateMethod`). Protected and public must not.
- **Class member order**: fields → constructor → public getters/setters → public methods → protected → private (enforced by ESLint).
- **Imports**: Sorted by `simple-import-sort` ESLint plugin.
- **No explicit `public`**: The `public` keyword is forbidden on class members (use implicit public).
- **Strict TypeScript**: `strict: true`, `noImplicitReturns`, `noImplicitOverride`, target ES2020.
