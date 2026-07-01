/*
 * sourceFileLifetime.probe.test.ts
 *
 * Opt-in heap-retention probes for source file lifetime work.
 */

import assert from 'assert';

import { CancellationToken } from 'vscode-jsonrpc';

import { OperationCanceledException } from '../common/cancellationUtils';
import { UriEx } from '../common/uri/uriUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';

jest.setTimeout(60000);

const heapTest = process.env.PYRIGHT_RUN_HEAP_PROBES === '1' ? test : test.skip;
const weakRefCtor = (globalThis as any).WeakRef as
    | (new (target: object) => { deref(): object | undefined })
    | undefined;

heapTest('probe invalidation paths release old syntax objects', async () => {
    if (!global.gc || !weakRefCtor) {
        return;
    }

    for (const path of ['updateChainedUri', 'markFilesDirty', 'markAllFilesDirty', 'emptyCache']) {
        const result = runSyntaxInvalidationProbe(path);
        await assertCollected(path, result.weakRefs);
        assertDisposedEvaluator(path, result.oldEvaluator);
        assert(result.program);
    }
});

heapTest('probe invalid type-cache cancellation disposes old type results', async () => {
    if (!global.gc || !weakRefCtor) {
        return;
    }

    const result = runTypeCacheInvalidationProbe();
    await assertCollected('invalidTypeCacheCancellation', result.weakRefs);
    assertDisposedEvaluator('invalidTypeCacheCancellation', result.oldEvaluator);
    assert(result.program);
});

function runSyntaxInvalidationProbe(path: string) {
    const { state, program, uri } = analyzeLifetimeSample();
    const sourceFileInfo = program.getSourceFileInfo(uri)!;
    const writableData = (sourceFileInfo.sourceFile as any)._writableData;
    const oldEvaluator = program.evaluator as any;

    assert(oldEvaluator.getEvaluatorCacheStats().typeCache > 0);
    const weakRefs = captureSyntaxWeakRefs(writableData);

    if (path === 'updateOpenFileContents') {
        const oldContents = sourceFileInfo.sourceFile.getOpenFileContents()!;
        state.workspace.service.updateOpenFileContents(uri, 2, `${oldContents}\nextra_value = 1\n`);
    } else if (path === 'setFileOpened') {
        const oldContents = sourceFileInfo.sourceFile.getOpenFileContents()!;
        state.workspace.service.setFileOpened(uri, 2, `${oldContents}\nextra_value = 1\n`);
    } else if (path === 'updateChainedUri') {
        const chainedUri = UriEx.file('/projectRoot/chained.py');
        program.setFileOpened(chainedUri, 1, 'chained_value = 1');
        program.updateChainedUri(uri, chainedUri);
    } else if (path === 'markFilesDirty') {
        program.markFilesDirty([uri], /* evenIfContentsAreSame */ true);
    } else if (path === 'markAllFilesDirty') {
        program.markAllFilesDirty(/* evenIfContentsAreSame */ true);
    } else if (path === 'emptyCache') {
        program.emptyCache();
    } else {
        assert.fail(`Unknown invalidation path ${path}`);
    }

    return { weakRefs, oldEvaluator, program, state };
}

function runTypeCacheInvalidationProbe() {
    const { program, uri } = analyzeLifetimeSample();
    const parserOutput = program.getParseResults(uri)!.parserOutput;
    const oldEvaluator = program.evaluator as any;
    const nameNode = findNameNode(parserOutput.parseTree, 'retained_instance');
    assert(nameNode);

    const typeResult = oldEvaluator.getTypeOfExpression(nameNode);
    assert(typeResult);
    const weakRefs = [{ name: 'typeResult', ref: new weakRefCtor!(typeResult) }];

    const cancellation = new OperationCanceledException();
    cancellation.isTypeCacheInvalid = true;
    assert.throws(() =>
        program.run(() => {
            throw cancellation;
        }, CancellationToken.None)
    );

    return { weakRefs, oldEvaluator, program };
}

function analyzeLifetimeSample() {
    const code = `
// @filename: test.py
//// # module comment retained on token
//// from typing import Generic, TypeVar
////
//// T = TypeVar("T")
////
//// class Retained(Generic[T]):
////     # class comment retained on token
////     value: T
////
////     def __init__(self, value: T) -> None:
////         self.value = value
////
////     def method(self, item: T | None) -> T:
////         if item is None:
////             return self.value
////         return item
////
//// retained_instance = Retained(1)
//// result = retained_instance.method(None)
//// missing_type_ignore  # type: ignore[reportUndefinedVariable]
//// missing_pyright_ignore  # pyright: ignore[reportUndefinedVariable]
//// reveal_type(result)
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    return { state, program, uri };
}

function captureSyntaxWeakRefs(writableData: any) {
    const refs: { name: string; ref: { deref(): object | undefined } }[] = [];
    addWeakRef(refs, 'parserOutput', writableData.parserOutput);
    addWeakRef(refs, 'parseTree', writableData.parserOutput?.parseTree);
    addWeakRef(refs, 'tokenizerOutput', writableData.tokenizerOutput);
    addWeakRef(refs, 'moduleSymbolTable', writableData.moduleSymbolTable);
    addWeakRef(refs, 'sourceFileImportResult', writableData.imports?.[0]);
    addWeakRef(refs, 'sourceFileBuiltinsImportResult', writableData.builtinsImport);
    addWeakRef(refs, 'typeIgnoreComment', firstMapValue(writableData.typeIgnoreLines));
    addWeakRef(refs, 'pyrightIgnoreComment', firstMapValue(writableData.pyrightIgnoreLines));

    const tokenComments = findTokenComments(writableData.tokenizerOutput);
    addWeakRef(refs, 'tokenComments', tokenComments);
    addWeakRef(refs, 'firstTokenComment', tokenComments?.[0]);

    const retainedSymbol = writableData.moduleSymbolTable?.get('Retained');
    const retainedDeclaration = retainedSymbol?.getDeclarations()?.[0];
    addWeakRef(refs, 'retainedDeclaration', retainedDeclaration);
    addWeakRef(refs, 'retainedDeclarationNode', retainedDeclaration?.node);

    assert(refs.length >= 8);
    return refs;
}

function firstMapValue(map: Map<any, any> | undefined) {
    assert(map && map.size > 0);
    return map.values().next().value;
}

function addWeakRef(refs: { name: string; ref: { deref(): object | undefined } }[], name: string, target: any) {
    assert(target, `${name} probe target should exist`);
    refs.push({ name, ref: new weakRefCtor!(target) });
}

function findTokenComments(tokenizerOutput: any) {
    const tokens = tokenizerOutput?.tokens;
    assert(tokens);

    for (let i = 0; i < tokens.count; i++) {
        const comments = tokens.getItemAt(i).comments;
        if (comments?.length) {
            return comments;
        }
    }

    assert.fail('Expected at least one token comment');
}

function findNameNode(root: any, name: string): any {
    const seen = new Set<object>();
    const stack = [root];
    while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object' || seen.has(cur)) {
            continue;
        }

        seen.add(cur);
        if (cur.d?.value === name) {
            return cur;
        }

        for (const value of Object.values(cur)) {
            if (value && typeof value === 'object') {
                if (Array.isArray(value)) {
                    stack.push(...value);
                } else {
                    stack.push(value);
                }
            }
        }
    }

    return undefined;
}

async function assertCollected(path: string, refs: { name: string; ref: { deref(): object | undefined } }[]) {
    for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setImmediate(resolve));
        global.gc!();
        await new Promise((resolve) => setImmediate(resolve));
        const pressure = new Array(10000).fill(undefined).map((_, index) => ({ index }));
        assert(pressure.length > 0);
    }

    let retained = refs.filter((entry) => entry.ref.deref() !== undefined).map((entry) => entry.name);
    if (retained.length > 0) {
        await new Promise((resolve) => setImmediate(resolve));
        global.gc!();
        await new Promise((resolve) => setImmediate(resolve));
        retained = refs.filter((entry) => entry.ref.deref() !== undefined).map((entry) => entry.name);
    }

    assert.deepStrictEqual(retained, [], `${path} retained old objects`);
}

function assertDisposedEvaluator(path: string, oldEvaluator: any) {
    for (const [name, value] of Object.entries(oldEvaluator.getEvaluatorCacheStats())) {
        if (name !== 'evaluatorGeneration') {
            assert.strictEqual(value, 0, `${path}: ${name} should be cleared on evaluator disposal`);
        }
    }
}
