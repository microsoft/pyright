/*
 * referencesProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that finds all of the references to a symbol specified
 * by a location within a file.
 */

import { CancellationToken, Location, ResultProgressReporter } from 'vscode-languageserver';

import { Declaration, DeclarationType, isAliasDeclaration } from '../analyzer/declaration';
import { getNameFromDeclaration } from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { isUserCode } from '../analyzer/sourceFileInfoUtils';
import { Symbol } from '../analyzer/symbol';
import { isVisibleExternally } from '../analyzer/symbolUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { maxTypeRecursionCount } from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { appendArray, getOrAdd } from '../common/collectionUtils';
import { isDefined } from '../common/core';
import { assertNever } from '../common/debug';
import { DocumentRange } from '../common/docRange';
import { ProgramView, ReferenceUseCase, SourceFileInfo, SymbolUsageProvider } from '../common/extensibility';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { ServiceKeys } from '../common/serviceKeys';
import { isRangeInRange, Position, TextRange } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';
import {
    addDeclarationIfUnique,
    CollectionResult,
    DocumentSymbolCollector,
    getResultRangeKey,
} from './documentSymbolCollector';
import { convertDocumentRangesToLocation } from './navigationUtils';

export type ReferenceCallback = (locations: DocumentRange[]) => void;

// A reference location committed to `ReferencesResult`. We store the resolved `DocumentRange`
// (uri + line/char) plus the matched node's offset `range`, but deliberately NOT the matched `ParseNode`:
// results accumulate across the entire workspace walk, so holding a node would pin that file's parse tree
// and defeat the per-file `handleMemoryHighUsage()` tree eviction that runs during the walk. The offset
// `range` is just two numbers (no tree pinning); it lets the delta merge in `collectWorkspaceReferences`
// key this location exactly as the collector does. Consumers of the public results read `location`.
export interface ReferenceLocation {
    location: DocumentRange;
    range: TextRange;
}

// References found in a single file, plus any seed declarations the usage providers discovered
// while walking it (empty unless a provider opts into transitive seed discovery). Internal to this
// module: callers consume the returned object structurally and never import the type by name.
interface FileReferenceCollection {
    results: ReferenceLocation[];
    discoveredDeclarations: readonly Declaration[];
}

export class ReferencesResult {
    private readonly _results: ReferenceLocation[] = [];

    readonly nonImportDeclarations: Declaration[];

    constructor(
        readonly requiresGlobalSearch: boolean,
        readonly nodeAtOffset: ParseNode,
        readonly symbolNames: string[],
        // Invariant: this array only ever grows, and only via `mergeSeedDeclarations`. Its `length` is
        // reused as a free monotonic "seed version" for the per-file watermark skip in
        // `collectWorkspaceReferences`, so anything that appends here for a non-seed reason would
        // silently bump that version and drop needed re-walks. Do not push to it from elsewhere.
        readonly declarations: Declaration[],
        readonly useCase: ReferenceUseCase,
        readonly providers: readonly SymbolUsageProvider[],
        private readonly _reporter?: ReferenceCallback
    ) {
        // Filter out any import decls. but leave one with alias.
        this.nonImportDeclarations = declarations.filter((d) => {
            if (!isAliasDeclaration(d)) {
                return true;
            }

            // We must have alias and decl node that point to import statement.
            if (!d.usesLocalName || !d.node) {
                return false;
            }

            // d.node can't be ImportFrom if usesLocalName is true.
            // but we are doing this for type checker.
            if (d.node.nodeType === ParseNodeType.ImportFrom) {
                return false;
            }

            // Extract alias for comparison (symbolNames.some can't know d is for an Alias).
            const alias = d.node.d.alias?.d.value;

            // Check alias and what we are renaming is same thing.
            if (!symbolNames.some((s) => s === alias)) {
                return false;
            }

            return true;
        });
    }

    get containsOnlyImportDecls(): boolean {
        return this.declarations.length > 0 && this.nonImportDeclarations.length === 0;
    }

    get locations(): readonly DocumentRange[] {
        return this._results.map((l) => l.location);
    }

    get results(): readonly ReferenceLocation[] {
        return this._results;
    }

    addResults(...locs: ReferenceLocation[]) {
        if (locs.length === 0) {
            return;
        }

        if (this._reporter) {
            this._reporter(locs.map((l) => l.location));
        }

        appendArray(this._results, locs);
    }
}

export class FindReferencesTreeWalker {
    private _parseResults: ParseFileResults | undefined;

    constructor(
        private _program: ProgramView,
        private _fileUri: Uri,
        private _referencesResult: ReferencesResult,
        private _includeDeclaration: boolean,
        private _cancellationToken: CancellationToken,
        private readonly _createDocumentRange: (
            fileUri: Uri,
            result: CollectionResult,
            parseResults: ParseFileResults
        ) => DocumentRange = FindReferencesTreeWalker.createDocumentRange,
        private readonly _previousResultRanges?: ReadonlySet<string>
    ) {
        this._parseResults = this._program.getParseResults(this._fileUri);
    }

    findReferences(rootNode = this._parseResults?.parserOutput.parseTree): FileReferenceCollection {
        const results: ReferenceLocation[] = [];
        if (!this._parseResults) {
            return { results, discoveredDeclarations: [] };
        }

        const collector = new DocumentSymbolCollector(
            this._program,
            this._referencesResult.symbolNames,
            this._referencesResult.declarations,
            rootNode!,
            this._cancellationToken,
            {
                treatModuleInImportAndFromImportSame: true,
                skipUnreachableCode: false,
                useCase: this._referencesResult.useCase,
                providers: this._referencesResult.providers,
                previousResultRanges: this._previousResultRanges,
            }
        );

        for (const result of collector.collect()) {
            // `result.node` is inspected only here, while this file's parse tree is still live; we do
            // not store it on the committed result so the tree can be dropped after this file is walked.
            if (this._includeDeclaration || result.node !== this._referencesResult.nodeAtOffset) {
                results.push({
                    location: this._createDocumentRange(this._fileUri, result, this._parseResults),
                    range: result.range,
                });
            }
        }

        return { results, discoveredDeclarations: collector.getSeedDeclarations() };
    }

    static createDocumentRange(fileUri: Uri, result: CollectionResult, parseResults: ParseFileResults): DocumentRange {
        return {
            uri: fileUri,
            range: {
                start: convertOffsetToPosition(result.range.start, parseResults.tokenizerOutput.lines),
                end: convertOffsetToPosition(TextRange.getEnd(result.range), parseResults.tokenizerOutput.lines),
            },
        };
    }
}

export class ReferencesProvider {
    constructor(
        private _program: ProgramView,
        private _token: CancellationToken,
        private readonly _createDocumentRange?: (
            fileUri: Uri,
            result: CollectionResult,
            parseResults: ParseFileResults
        ) => DocumentRange,
        private readonly _convertToLocation?: (fs: ReadOnlyFileSystem, ranges: DocumentRange) => Location | undefined
    ) {
        // empty
    }

    reportReferences(
        fileUri: Uri,
        position: Position,
        includeDeclaration: boolean,
        resultReporter?: ResultProgressReporter<Location[]>
    ) {
        const sourceFileInfo = this._program.getSourceFileInfo(fileUri);
        if (!sourceFileInfo) {
            return;
        }

        const parseResults = this._program.getParseResults(fileUri);
        if (!parseResults) {
            return;
        }

        const locations: Location[] = [];
        const reporter: ReferenceCallback = resultReporter
            ? (range) =>
                  resultReporter.report(
                      convertDocumentRangesToLocation(this._program.fileSystem, range, this._convertToLocation)
                  )
            : (range) =>
                  appendArray(
                      locations,
                      convertDocumentRangesToLocation(this._program.fileSystem, range, this._convertToLocation)
                  );

        const invokedFromUserFile = isUserCode(sourceFileInfo);

        // A file participates in find-all-references when it is open in the editor, or the request
        // originated from non-user code, or it is user code.
        const isReferenceCandidateFile = (info: SourceFileInfo) =>
            info.isOpenByClient || !invokedFromUserFile || isUserCode(info);

        const referencesResult = ReferencesProvider.getDeclarationForPosition(
            this._program,
            fileUri,
            position,
            reporter,
            ReferenceUseCase.References,
            this._token
        );
        if (!referencesResult) {
            return;
        }

        // Do we need to do a global search as well?
        if (!referencesResult.requiresGlobalSearch) {
            this.addReferencesToResult(sourceFileInfo.uri, includeDeclaration, referencesResult);
        }

        // Collect references across the workspace. Some symbols are found as a group (protocol
        // members and TypedDict keys that share a name), and the rest of the group only becomes
        // known once their usages in other files are examined. A single workspace walk pulls in
        // those related declarations so the result covers the entire group.
        this.collectWorkspaceReferences(referencesResult, includeDeclaration, isReferenceCandidateFile);

        // Make sure to include declarations regardless where they are defined
        // if includeDeclaration is set.
        if (includeDeclaration) {
            for (const decl of referencesResult.declarations) {
                throwIfCancellationRequested(this._token);

                if (referencesResult.locations.some((l) => l.uri.equals(decl.uri))) {
                    // Already included.
                    continue;
                }

                const declFileInfo = this._program.getSourceFileInfo(decl.uri);
                if (!declFileInfo) {
                    // The file the declaration belongs to doesn't belong to the program.
                    continue;
                }

                const tempResult = new ReferencesResult(
                    referencesResult.requiresGlobalSearch,
                    referencesResult.nodeAtOffset,
                    referencesResult.symbolNames,
                    referencesResult.declarations,
                    referencesResult.useCase,
                    referencesResult.providers
                );

                this.addReferencesToResult(declFileInfo.uri, includeDeclaration, tempResult);
                for (const result of tempResult.results) {
                    // Include declarations only. And throw away any references
                    if (result.location.uri.equals(decl.uri) && isRangeInRange(decl.range, result.location.range)) {
                        referencesResult.addResults(result);
                    }
                }
            }
        }

        // Deduplicate locations before returning them.
        const locationsSet = new Set<string>();
        const dedupedLocations: Location[] = [];
        for (const loc of locations) {
            const key = `${loc.uri.toString()}:${loc.range.start.line}:${loc.range.start.character}`;
            if (!locationsSet.has(key)) {
                locationsSet.add(key);
                dedupedLocations.push(loc);
            }
        }

        return dedupedLocations;
    }

    // Collects references in a single file without committing them to `referencesResult`, returning
    // the per-file results plus any seed declarations the usage providers discovered while walking.
    collectFileReferences(
        fileUri: Uri,
        includeDeclaration: boolean,
        referencesResult: ReferencesResult,
        previousResultRanges?: Set<string>
    ): FileReferenceCollection {
        const parseResults = this._program.getParseResults(fileUri);
        if (!parseResults) {
            return { results: [], discoveredDeclarations: [] };
        }

        const refTreeWalker = new FindReferencesTreeWalker(
            this._program,
            fileUri,
            referencesResult,
            includeDeclaration,
            this._token,
            this._createDocumentRange,
            previousResultRanges
        );

        return refTreeWalker.findReferences();
    }

    addReferencesToResult(fileUri: Uri, includeDeclaration: boolean, referencesResult: ReferencesResult): void {
        const collected = this.collectFileReferences(fileUri, includeDeclaration, referencesResult);
        referencesResult.addResults(...collected.results);
    }

    // Walks the workspace to collect references into `referencesResult`. For ordinary symbols the seed
    // declaration set cannot grow, so this is a single pass and results stream out per file as they are
    // found.
    //
    // Seed-usage providers (protocol members, TypedDict keys) can reveal additional declarations
    // only after a usage in one file is matched, and that declaration may live in a file walked
    // before the one that reveals it. When such a provider is active we repeat the workspace walk
    // until the declaration set stops growing. Results are not discarded between passes: each pass
    // streams only that file's newly found locations (its delta) into `referencesResult`, which
    // accumulates across passes (it is never cleared), so the running result is always exactly
    // previous + deltas. This is the same `DocumentSymbolCollector` run that collects references, so
    // growth costs no extra walk beyond the re-passes growth requires.
    //
    // Cost model: when nothing propagates -- ordinary symbols, or a seed symbol whose first pass
    // discovers no new declarations -- this is a single workspace walk, identical to the non-seed path.
    // When the seed grows we re-walk, but each later pass skips every file already processed at the
    // current seed version: we keep a per-file watermark of the seed version it was last walked at
    // (`referencesResult.declarations.length`, a free monotonically increasing version) and re-examine a
    // file only after the seed grows past that watermark. A file is therefore re-collected only when new
    // declarations could give it new matches, and a converged file is visited at most once more to
    // confirm no new matches at the final seed -- not once per pass. We deliberately never pay the worst
    // case up front: there is no eager pre-pass that scans the whole workspace just to harvest every
    // declaration before collecting results. Work grows lazily, only when we discover more to search.
    //
    // The loop runs to a genuine fixpoint with no pass cap: the declaration set grows monotonically
    // and is bounded by the finite set of declarations in the workspace, so convergence is guaranteed.
    // A cap would risk emitting a silently incomplete rename/reference set (broken edit) on a deep
    // cross-file chain; the only acceptable early exit is cancellation, which aborts the whole request
    // rather than returning a partial result.
    //
    // NOTE: keep observable behavior in lockstep with AsyncReferencesProvider.collectWorkspaceReferences.
    collectWorkspaceReferences(
        referencesResult: ReferencesResult,
        includeDeclaration: boolean,
        isCandidateFile: (sourceFileInfo: SourceFileInfo) => boolean
    ): void {
        // Whether the seed can grow is the usage providers' policy, not this engine's. A provider that
        // exposes `appendSeedDeclarationsAt` may contribute sibling declarations during the walk, so the
        // result set is not final until the workspace-wide fixpoint settles. (Today's protocol/TypedDict
        // providers expose it only for rename and leave it unbound for Find All References, but the engine
        // no longer depends on that -- it just checks the hook.)
        const canGrowSeed = referencesResult.providers.some((p) => p.appendSeedDeclarationsAt !== undefined);

        // Per-file delta handle. When the seed can grow we re-walk files as the seed expands, and the same
        // location can be re-found on several passes. To avoid re-reporting it, each file keeps the set of
        // result ranges already found in it (keyed via `getResultRangeKey`) and hands that
        // set to the collector as its read-only "previous result" (modeled on the semantic-tokens /
        // pull-diagnostics delta APIs). The collector returns only that file's delta -- the locations new
        // since the previous result -- without ever mutating the set; this provider then merges the delta
        // back into the set (below) so the next re-walk yields just the seed-growth additions. Each delta is
        // streamed straight into `referencesResult`, so the running result is exactly previous + deltas with
        // no separate dedup pass. (The non-growing path needs no handle: each file is walked once, so its
        // first results are final and stream immediately.)
        const previousResultRangesByFile = canGrowSeed ? new Map<string, Set<string>>() : undefined;

        // Per-file watermark of the seed version (`referencesResult.declarations.length`) each file was
        // last walked at. Lets later passes skip files already processed at the current seed version,
        // re-collecting a file only after the seed grows past its watermark.
        const lastWalkedSeedVersion = canGrowSeed ? new Map<string, number>() : undefined;

        // Design decision -- correctness over performance: this fixpoint walk is intentionally NOT
        // capped for performance, and it never truncates the result to "go faster". Returning a
        // broken/partial answer in the name of perf is the worst possible outcome here: a partial rename
        // silently corrupts code, and a partial reference set misleads the user. The only acceptable way
        // to stop early is user cancellation (`throwIfCancellationRequested` below); short of that we
        // always run to a complete, correct result. If a large workspace makes this slow, the answer is
        // for the user to cancel -- not for us to return a wrong answer.
        //
        // Growth is monotonic over the finite set of workspace declarations, so the loop is guaranteed to
        // converge as long as `mergeSeedDeclarations` only reports growth when the deduped
        // (`areDeclarationsSame`) declaration set actually increases.

        let grew = true;
        while (grew) {
            throwIfCancellationRequested(this._token);

            grew = false;

            for (const curSourceFileInfo of this._program.getSourceFileInfoList()) {
                throwIfCancellationRequested(this._token);

                // "Find all references" will only include references from user code unless the file
                // is explicitly opened in the editor or it is invoked from non user files.
                if (!isCandidateFile(curSourceFileInfo)) {
                    continue;
                }

                const fileKey = curSourceFileInfo.uri.key;

                // `referencesResult.declarations.length` is a free, monotonically increasing seed version
                // (it only grows via mergeSeedDeclarations). Capture it before the walk so it reflects the
                // seed this file is matched against. Unused (0) when the seed can't grow.
                const seedVersion = canGrowSeed ? referencesResult.declarations.length : 0;

                // Seed-version skip: a file re-processed at the same seed version yields identical results,
                // so skip any file already walked (or examined) at the current version. A file with no
                // watermark is always considered, so later seed/name growth still reaches it.
                if (canGrowSeed && lastWalkedSeedVersion!.get(fileKey) === seedVersion) {
                    continue;
                }

                // Record the seed version BEFORE matching this file, so the watermark reflects exactly the
                // seed snapshot the entire walk of this file is matched against. collectFileReferences
                // matches the whole file against the seed as it stands now; the seed only grows afterward
                // (via mergeSeedDeclarations below), which bumps the global version past this watermark and
                // triggers exactly one more re-walk of this file against the final seed. Recording it here --
                // rather than after the walk -- guarantees a file is never matched against a seed newer than
                // its watermark, so no single file can be matched against two different seed versions.
                lastWalkedSeedVersion?.set(fileKey, seedVersion);

                // See if the reference symbol's string is located somewhere within the file.
                // If not, we can skip additional processing for the file.
                const fileContents = curSourceFileInfo.contents;
                if (fileContents && !referencesResult.symbolNames.some((s) => fileContents.indexOf(s) >= 0)) {
                    // No possible match at this seed version; re-examine only after the seed (and thus the
                    // symbol-name set) grows past the watermark recorded above.
                    continue;
                }

                // Per-file delta handle: reuse the same set across passes so the collector treats it as the
                // previous result and returns only this file's seed-growth additions. Absent when the seed
                // cannot grow (single walk).
                const previousResultRanges = previousResultRangesByFile
                    ? getOrAdd(previousResultRangesByFile, fileKey, () => new Set<string>())
                    : undefined;

                const collected = this.collectFileReferences(
                    curSourceFileInfo.uri,
                    includeDeclaration,
                    referencesResult,
                    previousResultRanges
                );

                if (canGrowSeed && mergeSeedDeclarations(referencesResult, collected.discoveredDeclarations)) {
                    grew = true;
                }

                // The collector returns only this file's delta: locations not in the previous-result set it
                // was given (the whole result on a file's first walk, just the seed-growth additions on a
                // re-walk). Appending each delta as it arrives builds the full result incrementally -- full
                // result = previous result + streamed deltas -- so results stream out even while the seed is
                // still growing, with no separate dedup pass.
                referencesResult.addResults(...collected.results);

                // Provider owns the delta merge: fold this file's newly collected ranges into its read-only
                // previous-result set so the next seed-growth pass skips them. The collector returned only
                // the delta and never touched the set.
                if (previousResultRanges) {
                    for (const loc of collected.results) {
                        previousResultRanges.add(getResultRangeKey(loc.range));
                    }
                }

                // This operation can consume significant memory, so check
                // for situations where we need to discard the type cache.
                this._program.handleMemoryHighUsage();
            }

            if (!canGrowSeed) {
                // Single streaming pass; results were already committed above.
                return;
            }

            // Seed-growth path: the collector streamed each location exactly once -- as the per-file delta
            // on the pass it was first found -- so once the seed stops growing there is nothing left to commit.
        }
    }

    static getDeclarationForNode(
        program: ProgramView,
        fileUri: Uri,
        node: NameNode,
        reporter: ReferenceCallback | undefined,
        useCase: ReferenceUseCase,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const declarations = DocumentSymbolCollector.getDeclarationsForNode(program, node, token, {
            resolveLocalNames: false,
        });

        if (declarations.length === 0) {
            return undefined;
        }

        const requiresGlobalSearch = isVisibleOutside(program.evaluator!, fileUri, node, declarations);
        const symbolNames = new Set<string>(declarations.map((d) => getNameFromDeclaration(d)!).filter((n) => !!n));
        symbolNames.add(node.d.value);

        const providers = (program.serviceProvider.tryGet(ServiceKeys.symbolUsageProviderFactory) ?? [])
            .map((f) => f.tryCreateProvider(useCase, declarations, token))
            .filter(isDefined);

        // Check whether we need to add new symbol names and declarations.
        providers.forEach((p) => {
            p.appendSymbolNamesTo(symbolNames);
            p.appendDeclarationsTo(declarations);
        });

        return new ReferencesResult(
            requiresGlobalSearch,
            node,
            Array.from(symbolNames.values()),
            declarations,
            useCase,
            providers,
            reporter
        );
    }

    static getDeclarationForPosition(
        program: ProgramView,
        fileUri: Uri,
        position: Position,
        reporter: ReferenceCallback | undefined,
        useCase: ReferenceUseCase,
        token: CancellationToken
    ): ReferencesResult | undefined {
        throwIfCancellationRequested(token);
        const parseResults = program.getParseResults(fileUri);
        if (!parseResults) {
            return undefined;
        }

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parserOutput.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        // If this is a name node, process it directly.
        if (node.nodeType === ParseNodeType.Name) {
            return this.getDeclarationForNode(program, fileUri, node, reporter, useCase, token);
        }

        // For other node types, there are no references to be found.
        return undefined;
    }
}

// Merges newly discovered seed declarations into `referencesResult`, also widening `symbolNames`
// with any new declaration names so later passes and the result loop scan the right files. Returns
// whether the declaration set actually grew.
function mergeSeedDeclarations(referencesResult: ReferencesResult, discovered: readonly Declaration[]): boolean {
    let grew = false;
    for (const decl of discovered) {
        const before = referencesResult.declarations.length;
        addDeclarationIfUnique(referencesResult.declarations, decl);
        if (referencesResult.declarations.length !== before) {
            grew = true;
            const name = getNameFromDeclaration(decl);
            if (name && !referencesResult.symbolNames.includes(name)) {
                referencesResult.symbolNames.push(name);
            }
        }
    }
    return grew;
}

function isVisibleOutside(evaluator: TypeEvaluator, currentUri: Uri, node: NameNode, declarations: Declaration[]) {
    const result = evaluator.lookUpSymbolRecursive(node, node.d.value, /* honorCodeFlow */ false);
    if (result && !isExternallyVisible(result.symbol)) {
        return false;
    }

    // A symbol's effective external visibility check is not enough to determine whether
    // the symbol is visible to the outside. Something like the local variable inside
    // a function will still say it is externally visible even if it can't be accessed from another module.
    // So, we also need to determine whether the symbol is declared within an evaluation scope
    // that is within the current file and cannot be imported directly from other modules.
    return declarations.some((decl) => {
        // If the declaration is outside of this file, a global search is needed.
        if (!decl.uri.equals(currentUri)) {
            return true;
        }

        const evalScope = ParseTreeUtils.getEvaluationScopeNode(decl.node).node;

        // If the declaration is at the module level or a class level, it can be seen
        // outside of the current module, so a global search is needed.
        if (evalScope.nodeType === ParseNodeType.Module || evalScope.nodeType === ParseNodeType.Class) {
            return true;
        }

        // If the name node is a member variable, we need to do a global search.
        if (decl.node?.parent?.nodeType === ParseNodeType.MemberAccess && decl.node === decl.node.parent.d.member) {
            return true;
        }

        return false;
    });

    // Return true if the symbol is visible outside of current module, false if not.
    function isExternallyVisible(symbol: Symbol, recursionCount = 0): boolean {
        if (recursionCount > maxTypeRecursionCount) {
            return false;
        }

        recursionCount++;

        if (!isVisibleExternally(symbol)) {
            return false;
        }

        return symbol.getDeclarations().reduce<boolean>((isVisible, decl) => {
            if (!isVisible) {
                return false;
            }

            switch (decl.type) {
                case DeclarationType.Alias:
                case DeclarationType.Intrinsic:
                case DeclarationType.SpecialBuiltInClass:
                    return isVisible;

                case DeclarationType.Class:
                case DeclarationType.Function:
                    return isVisible && isContainerExternallyVisible(decl.node.d.name, recursionCount);

                case DeclarationType.Param:
                    return isVisible && isContainerExternallyVisible(decl.node.d.name!, recursionCount);

                case DeclarationType.TypeParam:
                    return false;

                case DeclarationType.Variable:
                case DeclarationType.TypeAlias: {
                    if (decl.node.nodeType === ParseNodeType.Name) {
                        return isVisible && isContainerExternallyVisible(decl.node, recursionCount);
                    }

                    // Symbol without name is not visible outside.
                    return false;
                }

                default:
                    assertNever(decl);
            }
        }, /* visible */ true);
    }

    // Return true if the scope that contains the specified node is visible
    // outside of the current module, false if not.
    function isContainerExternallyVisible(node: NameNode, recursionCount: number) {
        let scopingNodeInfo = ParseTreeUtils.getEvaluationScopeNode(node);
        let scopingNode = scopingNodeInfo.node;

        // If this is a type parameter scope, it acts as a proxy for
        // its outer (parent) scope.
        while (scopingNodeInfo.useProxyScope && scopingNodeInfo.node.parent) {
            scopingNodeInfo = ParseTreeUtils.getEvaluationScopeNode(scopingNodeInfo.node.parent);
            scopingNode = scopingNodeInfo.node;
        }

        switch (scopingNode.nodeType) {
            case ParseNodeType.Class:
            case ParseNodeType.Function: {
                const name = scopingNode.d.name;
                const result = evaluator.lookUpSymbolRecursive(name, name.d.value, /* honorCodeFlow */ false);
                return result ? isExternallyVisible(result.symbol, recursionCount) : true;
            }

            case ParseNodeType.Lambda:
            case ParseNodeType.Comprehension:
            case ParseNodeType.TypeParameterList:
                // Symbols in this scope can't be visible outside.
                return false;

            case ParseNodeType.Module:
                return true;

            default:
                assertNever(scopingNode);
        }
    }
}
