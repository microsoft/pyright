# Source file lifetime and memory redesign

## Problem statement

Recent heap work closed one concrete source-retention path in parser-synthesized type-comment tokens, but the broader
source-file lifetime model still keeps large objects alive longer than necessary. The current close/edit/cache behavior is
not explicit enough about which data must remain queryable and which data can be released.

The characterization tests in `packages/pyright-internal/src/tests/service.test.ts` show the current behavior:

- `setFileClosed` drops client document contents and the tokenizer cache, but a tracked closed file can keep
  `parserOutput`, `parsedFileContents`, and token comments through parse-tree token objects.
- `updateOpenFileContents` resets evaluator caches, but the private stale `parserOutput` remains until the next reparse or
  cache-clear path.
- `emptyCache()` is the strong release path that drops parse trees and parsed source contents for tracked closed files.

This means file close is not currently a reliable memory boundary. It also means dropping `tokenizerOutput` does not release
all comment text, because comments can be retained by tokens embedded in the parse tree.

## Goals

- Make source-file lifetime explicit and testable.
- Release full source text, parse trees, token objects, token comments, and tokenizer output when a closed file no longer
  needs full syntax.
- Preserve diagnostics, import graph behavior, symbol resolution, and language-service features that need compact summary
  data.
- Avoid retaining parse nodes through long-lived type and declaration caches when a compact declaration handle is enough.
- Keep changes incremental, with exact diagnostic validation on the NumPy top-10 benchmark before retaining behavior changes.

## Non-goals

- Do not redesign overload selection or protocol assignability in this plan.
- Do not remove comment-derived features such as `# type: ignore`, `# pyright: ignore`, task-list diagnostics, or type
  comments.
- Do not make closed-file release depend on V8 garbage collection timing. The owning references should be cleared explicitly.

## Proposed lifetime tiers

### Identity tier

Always retained for known files:

- URI and file id.
- Module name and import identity.
- Open/tracked/virtual flags.
- Content version, semantic version, last content hash, and last content length.
- Diagnostic version bookkeeping.

### Summary tier

Retained for closed tracked files when useful:

- Resolved import summary and dependency graph edges.
- Exported names and top-level symbol summary.
- `__all__` and wildcard-import markers.
- Compact diagnostic summaries and ignore-line metadata.
- Required doc strings or declaration text only when a language-service feature needs them.

The summary tier should not own a parse tree or full source text.

### Full syntax tier

Retained only for open files, files currently being parsed/bound/checked, or files selected by an explicit cache policy:

- `parserOutput` and parse tree nodes.
- Tokens embedded in parse nodes.
- Token comments.
- `tokenizerOutput` and tokenizer lines.
- Full `parsedFileContents`.
- `moduleSymbolTable` if it contains parse-node-backed declarations.

### Analysis cache tier

Evaluator-owned and generation-scoped:

- Type cache.
- Effective and expected type caches.
- Code-flow analyzer cache.
- Overloaded-call caches and weak maps.
- Any cached types or declarations that can reach parse nodes.

These caches should be disposable on evaluator reset and should not be the only owner keeping stale parse trees alive.

## Proposed implementation path

### 1. Add an explicit closed-file syntax release method

Add a method on `SourceFile` with close-specific semantics, for example:

```ts
releaseClosedFileSyntax(): void
```

It should be similar to `dropParseAndBindInfo()` but named for the close lifecycle rather than low-memory pressure. It should
clear:

- `parserOutput`
- `tokenizerLines`
- `tokenizerOutput`
- `parsedFileContents`
- `moduleSymbolTable`

It should preserve or rebuild compact summary fields required for import graph and diagnostics. If the file is actively
binding or checking, it should decline to release and leave the existing data in place.

### 2. Call the release method from file close

After `setClientVersion(null, '')` in `Program.setFileClosed`, release full syntax for closed files that remain tracked but
do not need an immediate syntax tree. Virtual files already become untracked and can continue through the removal path.

Conservative initial gate:

- file is closed by the client,
- file is not virtual,
- file is not currently binding or checking,
- file remains tracked,
- file is not immediately required by an in-progress operation.

The existing characterization test should then be updated to expect `parserOutput`, `parsedFileContents`, and token comments
to be gone after close.

### 3. Extract comment-derived data before dropping syntax

Do not rely on parse-tree token comments as durable storage. During parse/check, extract needed comment information into
compact structures:

- `# type: ignore` lines,
- `# pyright: ignore` lines,
- task-list diagnostics,
- type-comment annotations,
- any feature-specific doc/comment metadata that is required after close.

After extraction, general token comments should be treated as full-syntax data and released with the parse tree.

### 4. Strengthen edit invalidation

When open-file contents change, stale parse output should either be cleared immediately or moved into an explicit bounded
pre-edit snapshot used only by edit mode. The current behavior leaves old private `parserOutput` resident after public
`getParserOutput()` becomes invalid, which makes stale syntax lifetime harder to reason about.

Target behavior:

- content change increments the file generation,
- public and private current parse output are cleared,
- at most one explicit pre-edit generation is retained when edit mode requires it,
- successful reparse releases any old generation that is no longer needed.

### 5. Introduce declaration handles for long-lived caches

Long-lived type cache values can retain parse trees through declarations. `DeclarationBase.node` is a direct parse-node
back-reference, and class/function type details can retain declarations.

Introduce a compact handle for long-lived storage:

```ts
interface DeclarationHandle {
    uri: Uri;
    range: Range;
    type: DeclarationType;
    moduleName: string;
    nodeId?: number;
}
```

Short-lived analysis can still use parse-node-backed declarations. Durable type objects and caches should prefer handles and
resolve to a parse node only when a caller explicitly needs syntax and the matching file generation is available.

### 6. Add generation ownership

Make parse and evaluator data generation-aware:

- `SourceFile` owns a content generation.
- `parserOutput` records the generation it was built from.
- evaluator caches are associated with the evaluator generation and relevant file generations.
- close/edit invalidation can cheaply identify stale syntax and stale cache entries.

This avoids relying on object graph reachability as the only proof of freshness.

## Validation plan

### Unit and service tests

- Keep the current lifetime characterization tests until behavior changes.
- Add replacement tests that prove closed tracked files release `parserOutput`, `parsedFileContents`, and token comments.
- Add edit tests that prove stale private parse output is not retained outside explicit edit-mode snapshots.
- Add tests for comment-derived features after syntax release: type-ignore, pyright-ignore, task-list diagnostics, and type
  comments.

### Build and behavior checks

- `npm run build` from `packages/pyright-internal`.
- Focused service tests in `src/tests/service.test.ts`.
- Existing type-comment and type-evaluator coverage touched by comment extraction.
- Top-10 NumPy diagnostic equivalence: `3148` errors / `61` warnings / `3209` diagnostic lines.

### Heap proof

Create a heap harness similar to `Q:\dev\benchmark-lsp\heap-proof\type-comment-retention-proof.js`:

- open and analyze a synthetic file with large comments and source text,
- close the file while keeping the program alive,
- force GC,
- snapshot or heap-profile retained objects,
- verify that full source text, parse tree, and token comments are not retained through closed-file state.

Run old/new modes against compiled output when possible so the proof isolates the lifecycle change.

## Risks and open questions

- Import graph updates may currently depend on parse output in more places than expected. Summary extraction needs to preserve
  dependency behavior before parse trees are dropped.
- Some language-service features may assume parse output exists for closed tracked files. Those features should request a
  reparse or use summary data.
- `moduleSymbolTable` may need a compact export summary before it can be dropped safely for closed files.
- Declaration-handle migration is larger than closed-file syntax release and should be staged separately.
- Reparse cost may increase for workflows that repeatedly query closed files. The cache policy should favor open files and
  recently queried files, not indefinite retention of every tracked file.

## Recommended first change

Start with the smallest falsifiable behavior change:

1. Add `SourceFile.releaseClosedFileSyntax()`.
2. Call it from `Program.setFileClosed` for closed tracked files.
3. Update the existing lifetime test to expect parse tree and token comments to be released on close.
4. Validate service tests, build, and top-10 diagnostics.
5. Add a heap proof showing closed-file source/comment release while the program remains alive.

If this breaks language-service behavior, capture the missing data as an explicit summary field rather than retaining the
entire parse tree by default.
