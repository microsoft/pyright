# Source lifetime model

This doc describes the objects that keep source data alive in Pyright and the intended lifetime boundaries for each owner.
Use it as the mental model for memory investigations before changing invalidation behavior.

## Ownership layers

| Layer | Primary owner | Examples | Intended lifetime |
| --- | --- | --- | --- |
| File identity | `SourceFileInfo`, `SourceFile` | URI, file id, tracked/open/virtual flags, client/content/semantic versions, diagnostic version | As long as the file is known to `Program`. |
| Dependency graph | `SourceFileInfo` | `imports`, `importedBy`, `builtinsImport`, `chainedSourceFile`, shadowing edges | As long as the file remains in the program or edit-mode snapshot. This is the graph authority after parsing. |
| Source syntax | `SourceFile.WriteableData` | `parserOutput`, parse tree, parse-node tokens/comments, `tokenizerOutput`, `tokenizerLines`, `parsedFileContents`, `moduleSymbolTable` | Open files, active parse/bind/check, or until explicitly released on dirty/close/cache pressure. |
| Source summaries | `SourceFile.WriteableData` | diagnostics, ignore-line maps, circular dependency records, `lineCount`, content hash/length, diagnostic rule set | Retained after syntax release if needed for diagnostics, range queries, and file-change checks. |
| Resolved import details | `SourceFile.WriteableData` during parse, `SourceFileInfo` after graph update | `ImportResult[]`, builtins `ImportResult`, then `SourceFileInfo` dependency edges | `ImportResult` objects are temporary parse/source data; `SourceFileInfo` edges survive syntax release. |
| Evaluator caches | `TypeEvaluator` closure | `typeCache`, flow/effective/expected caches, deferred class completions, return inference temp cache, speculative state, prefetched types | One evaluator generation. Must be disposed on semantic invalidation and must not be the last owner of stale parse generations. |
| Edit-mode snapshots | `SourceFileInfo._preEditData`, `SourceFile._preEditData` | Previous graph/source writable data while edit mode is active | Only until edit mode exits and restores or discards the temporary state. |

## Key references in current code

- `SourceFile.WriteableData` stores the source-owned lifetime fields, including syntax, diagnostics, ignore metadata, and
  temporary `ImportResult` objects.
- `SourceFileInfo.WriteableData` stores program graph edges and open/tracked state. This is the dependency graph authority
  once `Program._updateSourceFileImports` has consumed `SourceFile.getImports()`.
- `Program.setFileOpened`, `setFileClosed`, `markFilesDirty`, `markAllFilesDirty`, `updateChainedUri`, and `emptyCache`
  are the important source/evaluator lifetime boundaries.
- `Program._createNewEvaluator()` is the whole-evaluator generation boundary.
- `TypeEvaluator.disposeEvaluator()` is the evaluator-owned retainer boundary.

## Intended lifetime rules

### Opening a file

- Opening a brand-new file, or a known file that has never had contents observed and has no dependency/shadow graph
  participation, creates open-source state but should not recreate the evaluator only because the file did not previously have
  contents.
- Reopening or updating a known file with changed semantic contents marks that file and dependents dirty.
- No-op updates to already-open files should preserve evaluator state and published diagnostic-version state.
- Normal changed contents recreate the evaluator. Edit-mode changed contents dirty affected files but defer evaluator recreation
  until edit mode exits.
- Builtins changes are special: `builtins.pyi` and `__builtins__.pyi` must dirty all files because ordinary import edges do
  not fully represent their implicit dependency.

### Closing a file

- Closing an unchanged file is not an edit and should not recreate the evaluator.
- Closing should release source-owned syntax/import caches for files that remain known: parse tree, tokenizer output,
  parsed text, module symbol table, and temporary `ImportResult` objects.
- If close observes changed disk contents, it is a semantic content change: mark dirty, dirty dependents, and recreate the
  evaluator.
- Virtual documents are removed through tracking cleanup after close, so they do not need a long-lived closed-file syntax tier.

### Dirtying and cache pressure

- `markDirty` is a content-generation boundary: it increments content and semantic versions, clears full syntax, and requires
  bind/check again.
- Disk-change checks should ignore all open files, including open files whose client text is the empty string; client updates
  own open-file contents.
- `dropParseAndBindInfo` is a memory-pressure boundary: it releases syntax but preserves `lineCount` so current diagnostics
  can still be range-filtered correctly.
- `emptyCache` is a global cache-pressure boundary: it recreates the evaluator, discards cached parse results, and resets
  parsed-file accounting.
- Removing a file from `Program` should prepare the source file for close, release source-owned syntax/import data, and
  recreate the evaluator if the removed file had observed contents or releasable syntax.
- `Program.dispose` is the final ownership boundary: it should dispose evaluator retainers, release source-file syntax/open
  text, clear source-file lists/maps, and reset parsed-file accounting.

### Evaluator invalidation

- Evaluator caches are generation-scoped. Stale generation objects should be unreachable once the old evaluator is disposed.
- Disposal must clear durable retainers immediately, even if the evaluator is active.
- Active stacks and cancellation state may need to survive reentrant disposal until the active frame unwinds; pending inactive
  cleanup must then clear the rest.
- `_markFileDirtyRecursive` can find chained dependents that require evaluator recreation, but callers that already recreate
  the evaluator should suppress recursive self-recreation to avoid duplicate resets.

### Imports and dependency graph

- `SourceFile` `imports` and `builtinsImport` hold full `ImportResult` graphs and are parse/source-owned.
- `SourceFileInfo.imports`, `importedBy`, and `builtinsImport` are compact enough to retain and are the graph authority.
- Syntax release should clear `SourceFile` import results but must preserve `SourceFileInfo` edges.

## Known gaps and next questions

| Area | Current model | Gap to investigate |
| --- | --- | --- |
| Diagnostics | Diagnostics and ignore metadata are retained summaries after syntax release. | Confirm diagnostic messages and addenda do not retain large source/comment text beyond intended task-list messages. |
| Ignore metadata | `typeIgnoreLines`, `typeIgnoreAll`, and `pyrightIgnoreLines` are token-derived and used while recomputing diagnostics. | Current implementation now releases them with syntax after diagnostics are materialized; keep watching for recompute paths that would need them without reparsing. |
| Task-list diagnostics | Task diagnostics intentionally store comment text as the diagnostic message. | Decide whether task-list messages should remain for closed files or be recomputed only when syntax is loaded. |
| Declaration objects | Types can retain declarations, and declarations can reference parse nodes. | Heap probes currently show collection after evaluator/source release, so declaration-handle migration remains deferred until a real heap snapshot proves retention. |
| Module symbol tables | `moduleSymbolTable` is source syntax tier and is released with syntax. | Verify no other long-lived owner keeps parse-node-backed symbols for closed files. |
| Import resolver caches | Import resolver state is outside `SourceFile`/`SourceFileInfo`, and `emptyCache()` now clears resolver-owned import-result/module-name/parent-directory/Python-search-path caches. | Add real-project stats to quantify resolver cache size and decide whether cache usage should contribute to the low-memory high-water mark. |
| Edit-mode snapshots | Edit mode intentionally keeps pre-edit state alive until exit; edit-mode-created files now use the same removal release boundary as normal compaction. | Confirm long edit-mode sessions do not accumulate multiple generations per file. |
| Program removal/dispose | Removal and dispose are now explicit source/evaluator ownership boundaries. | Add real-heap measurements for worker restart/teardown to confirm end-to-end memory drops outside unit tests. |
| Open-file syntax | Open files retain syntax for language-service responsiveness. | Consider whether very large open files need pressure-based syntax release with fast reparse. |

## Investigation checklist

1. Identify the owner: `SourceFile`, `SourceFileInfo`, `TypeEvaluator`, import resolver, diagnostics, or edit snapshot.
2. Classify the object as identity, graph, syntax, summary, evaluator cache, or temporary edit state.
3. Find the intended release boundary for that class.
4. Check whether the boundary runs on no-op paths; no-op open/close/chain updates should not recreate evaluator generations.
5. Check whether the boundary misses real semantic changes; content, builtins, chain, disk-change-on-close, dirty, and cache-clear paths must invalidate the right owners.
6. Add a cache-stat assertion for evaluator-owned data or a heap probe for object collection when ownership is ambiguous.
