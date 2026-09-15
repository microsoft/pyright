/*
 * overloadResultController.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';

import { createAnalyzerNodeInfoAccessor } from '../analyzer/analyzerNodeInfo';
import { ImportResolver } from '../analyzer/importResolver';
import { ExperimentalOverloadResultOptions, OverloadResultEvent } from '../analyzer/overloadResultController';
import { getEnclosingFunction } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { Program } from '../analyzer/program';
import { EvalFlags, TypeEvaluator, TypeResult } from '../analyzer/typeEvaluatorTypes';
import {
    AnyType,
    FunctionType,
    isFunction,
    isOverloaded,
    isOverloadResult,
    OverloadedType,
    TypeCategory,
} from '../analyzer/types';
import { OperationCanceledException } from '../common/cancellationUtils';
import { ConfigOptions } from '../common/configOptions';
import { NullConsole } from '../common/console';
import { Diagnostic, DiagnosticCategory } from '../common/diagnostic';
import { FullAccessHost } from '../common/fullAccessHost';
import { pythonVersion3_12 } from '../common/pythonVersion';
import { createFromRealFileSystem, RealTempFile } from '../common/realFileSystem';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { UriEx } from '../common/uri/uriUtils';
import { HoverProvider } from '../languageService/hoverProvider';
import { CompletionProvider } from '../languageService/completionProvider';
import { CallNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { readSampleFile, resolveSampleFilePath } from './testUtils';

class Nodes extends ParseTreeWalker {
    readonly nodes: ParseNode[] = [];
    override visitNode(node: ParseNode) {
        this.nodes.push(node);
        return super.visitNode(node);
    }
}

const fixture = readSampleFile('overloadResultController1.py');

function resultSummary(evaluator: TypeEvaluator, result: TypeResult): object {
    const {
        type,
        bindToSelfType,
        unpackedType,
        typeList,
        inlinedTypeDict,
        classType,
        narrowedTypeForSet,
        overloadsUsedForCall,
        expectedTypeDiagAddendum,
        ...metadata
    } = result;
    return {
        ...metadata,
        type: evaluator.printType(type),
        bindToSelfType: bindToSelfType && evaluator.printType(bindToSelfType),
        unpackedType: unpackedType && evaluator.printType(unpackedType),
        inlinedTypeDict: inlinedTypeDict && evaluator.printType(inlinedTypeDict),
        classType: classType && evaluator.printType(classType),
        narrowedTypeForSet: narrowedTypeForSet && evaluator.printType(narrowedTypeForSet),
        overloadsUsedForCall: overloadsUsedForCall?.map((t) => evaluator.printType(t)),
        expectedTypeDiagAddendum: expectedTypeDiagAddendum?.getString(),
        typeList: typeList?.map(({ node, ...value }) => ({
            node: { start: node.start, length: node.length, nodeType: node.nodeType },
            value: resultSummary(evaluator, value),
        })),
    };
}

function create(
    content = fixture,
    options: Partial<ExperimentalOverloadResultOptions> | false = {},
    automaticConfiguration = false
) {
    const temp = new RealTempFile();
    const service = createServiceProvider(createFromRealFileSystem(temp), new NullConsole(), temp);
    const uri = UriEx.file(resolveSampleFilePath('overloadResultController1.py'));
    const config = new ConfigOptions(uri.getDirectory());
    config.defaultPythonVersion = pythonVersion3_12;
    config.internalTestMode = true;
    config.experimentalOverloadResults = automaticConfiguration;
    const resolver = new ImportResolver(service, config, new FullAccessHost(service));
    const events: OverloadResultEvent[] = [];
    const experiment: ExperimentalOverloadResultOptions = {
        seeds(module) {
            const info = createAnalyzerNodeInfoAccessor(program.analyzerNodeInfoReader);
            if (!info.getFileInfo(module).fileUri.equals(uri)) {
                return [];
            }
            const walker = new Nodes();
            walker.walk(module);
            return walker.nodes
                .filter(
                    (n): n is CallNode =>
                        n.nodeType === ParseNodeType.Call &&
                        n.d.leftExpr.nodeType === ParseNodeType.Name &&
                        n.d.leftExpr.d.value === 'choose'
                )
                .map((node) => ({
                    node,
                    uncertainty: TypeCategory.Any,
                    candidates(evaluator) {
                        const type = evaluator.getTypeOfExpression(node.d.leftExpr).type;
                        assert.ok(isOverloaded(type));
                        return OverloadedType.getOverloads(type).map((f) => FunctionType.getEffectiveReturnType(f)!);
                    },
                }));
        },
        ...(options || {}),
        observe(event) {
            events.push(event);
            if (options) {
                options.observe?.(event);
            }
        },
    };
    const program = new Program(
        resolver,
        config,
        service,
        undefined,
        undefined,
        undefined,
        undefined,
        options === false ? undefined : options.automatic ? { ...experiment, seeds: undefined } : experiment
    );
    program.setTrackedFiles([uri]);
    program.setFileOpened(uri, 1, content);
    program.getBoundSourceFile(uri);
    const walker = new Nodes();
    walker.walk(program.getParseResults(uri)!.parserOutput.parseTree);
    const module = program.getParseResults(uri)!.parserOutput.parseTree;
    const info = createAnalyzerNodeInfoAccessor(program.analyzerNodeInfoReader);
    const name = (value: string, fn = 'positive', occurrence = 0) => {
        const names = walker.nodes.filter(
            (n): n is NameNode =>
                n.nodeType === ParseNodeType.Name &&
                n.d.value === value &&
                getEnclosingFunction(n)?.d.name.d.value === fn
        );
        assert.ok(names[occurrence]);
        return names[occurrence];
    };
    const analyze = () => {
        let count = 0;
        while (program.analyze()) {
            assert.ok(++count < 100);
        }
        return program
            .getSourceFile(uri)!
            .getDiagnostics(config)!
            .map((d) => ({ category: d.category, rule: d.getRule(), message: d.message, range: d.range }));
    };
    let disposed = false;
    return {
        program,
        uri,
        config,
        events,
        module,
        nodes: walker.nodes,
        name,
        analyze,
        info,
        dispose() {
            if (!disposed) {
                program.dispose();
                service.dispose();
                disposed = true;
            }
        },
    };
}

test('AutomaticOverloadResult real matching preserves the fixed supported graph', () => {
    const fixed = create();
    const automatic = create(fixture, { automatic: true });
    try {
        assert.deepStrictEqual(automatic.analyze(), fixed.analyze());
        assert.ok(
            automatic.events.some((e) => e.kind === 'selection' && e.selection.reason === 'selected'),
            JSON.stringify(automatic.events.flatMap((e) => (e.kind === 'selection' ? [e.selection.reason] : [])))
        );
        const evaluator = automatic.program.evaluator!;
        assert.equal(
            evaluator.printType(evaluator.getType(automatic.name('ret'))!),
            'OverloadResult[list[int], list[str]]'
        );
    } finally {
        fixed.dispose();
        automatic.dispose();
    }
});

test.each([false, true])('AutomaticOverloadResult public consumers and reentry queryFirst=%s', (queryFirst) => {
    const test = create(fixture, { automatic: true });
    try {
        const evaluator = test.program.evaluator!;
        if (queryFirst) {
            assert.ok(isOverloadResult(evaluator.getType(test.name('alias'))!));
        }
        const diagnostics = test.analyze();
        const alias = test.name('alias');
        const canonical = evaluator.getType(alias);
        assert.ok(canonical && isOverloadResult(canonical));
        const position = (offset: number) => {
            const prefix = fixture.slice(0, offset);
            return { line: prefix.split('\n').length - 1, character: offset - prefix.lastIndexOf('\n') - 1 };
        };
        const hover = new HoverProvider(
            test.program,
            test.uri,
            position(alias.start),
            'markdown',
            CancellationToken.None
        ).getHover();
        assert.ok(JSON.stringify(hover).includes('OverloadResult[list[int], list[str]]'));
        for (const [text, labels] of [
            ['ret.append("x")', ['append', 'clear']],
            ['scalar.upper()', ['upper', 'bit_length']],
        ] as const) {
            const offset = fixture.indexOf(text) + text.indexOf('.') + 1;
            const provider = new CompletionProvider(
                test.program,
                test.uri,
                position(offset),
                { format: 'markdown', snippet: false, lazyEdit: false },
                CancellationToken.None
            );
            const completions = provider.getCompletions();
            for (const label of labels) {
                const completion = completions?.items.find((item) => item.label === label);
                assert.ok(completion, `${text}: ${label}`);
                provider.resolveCompletionItem(completion);
            }
        }
        const controller = test.program.experimentalOverloadResultController!;
        const selections = test.events.filter((e) => e.kind === 'selection').length;
        const target = test.name('string');
        assert.ok(target.parent?.parent?.nodeType === ParseNodeType.Assignment);
        for (let round = 0; round < 3; round++) {
            controller.evict(test.module);
            evaluator.evaluateTypesForStatement(alias.parent!);
            evaluator.evaluateTypesForStatement(target.parent.parent);
            assert.equal(evaluator.printType(evaluator.getCachedType(target)!), 'list[str]');
            assert.strictEqual(evaluator.getType(alias), canonical);
            assert.strictEqual(evaluator.getTypeResult(alias)!.type, canonical);
            assert.strictEqual(evaluator.getTypeOfExpression(alias).type, canonical);
            assert.deepStrictEqual(test.info.getFileInfo(test.module).diagnosticSink.fetchAndClear(), []);
        }
        assert.equal(test.events.filter((e) => e.kind === 'selection').length, selections);
        assert.deepStrictEqual(test.analyze(), diagnostics);
    } finally {
        test.dispose();
    }
});

test.each([false, true])(
    'OverloadResultController cold reverse use queries and no-return reentry automatic=%s',
    (automatic) => {
        const warm = create(fixture, { automatic });
        const cold = create(fixture, { automatic });
        try {
            const expected = warm.analyze();
            const targets = cold.nodes.filter(
                (node): node is NameNode =>
                    node.nodeType === ParseNodeType.Name &&
                    ['ret', 'alias', 'string', 'integer', 'projected', 'scalar'].includes(node.d.value)
            );
            for (const target of [...targets].reverse()) {
                cold.program.evaluator!.getType(target);
            }
            // Queries of declined/ordinary names can emit their ordinary errors
            // before the walk. Compare the full multiset, including duplicates.
            const ordered = (diagnostics: typeof expected) =>
                [...diagnostics].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
            assert.deepStrictEqual(ordered(cold.analyze()), ordered(expected));
            for (const target of targets) {
                const other = warm.nodes.find(
                    (node): node is NameNode => node.nodeType === ParseNodeType.Name && node.start === target.start
                )!;
                assert.deepStrictEqual(
                    resultSummary(cold.program.evaluator!, cold.program.evaluator!.getTypeOfExpression(target)),
                    resultSummary(warm.program.evaluator!, warm.program.evaluator!.getTypeOfExpression(other))
                );
            }
            assert.deepStrictEqual(cold.info.getFileInfo(cold.module).diagnosticSink.fetchAndClear(), []);
        } finally {
            warm.dispose();
            cold.dispose();
        }
    }
);

test('AutomaticOverloadResult exact target and declined controls', () => {
    const source = readSampleFile('overloadResultAutomatic1.py');
    const ordinary = create(source, false);
    const enabled = create(source, { automatic: true });
    try {
        // Rejected early-use graphs must remain ordinary even before checking.
        const evaluator = enabled.program.evaluator!;
        assert.equal(evaluator.printType(evaluator.getType(enabled.name('ret', 'early', 1))!), 'list[int]');
        const expected = ordinary.analyze();
        const actual = enabled.analyze();
        const inFunction = (diagnostics: typeof actual, fn: string) => {
            const node = getEnclosingFunction(enabled.name('ret', fn))!;
            const start = source.slice(0, node.start).split('\n').length - 1;
            const end = source.slice(0, node.start + node.length).split('\n').length - 1;
            return diagnostics.filter((d) => d.range.start.line >= start && d.range.start.line <= end);
        };
        for (const fn of [
            'prefix',
            'equal_returns',
            'default_argument',
            'type_variable',
            'unsupported_proof',
            'one_mapping',
            'concrete',
            'unknown',
            'any_argument',
            'union_argument',
            'keywords',
            'unpack',
            'receiver',
            'early',
        ]) {
            assert.deepStrictEqual(inFunction(actual, fn), inFunction(expected, fn), fn);
            assert.deepStrictEqual(
                resultSummary(evaluator, evaluator.getTypeOfExpression(enabled.name('ret', fn))),
                resultSummary(
                    ordinary.program.evaluator!,
                    ordinary.program.evaluator!.getTypeOfExpression(ordinary.name('ret', fn))
                ),
                fn
            );
        }
        for (const [fn, type] of [
            ['original', 'OverloadResult[list[int], list[str]]'],
            ['nested_invariant', 'OverloadResult[list[list[int]], list[list[str]]]'],
            ['custom_nominal', 'OverloadResult[Invariant[int], Invariant[str]]'],
            ['independent', 'OverloadResult[list[int], list[str]]'],
        ]) {
            assert.equal(evaluator.printType(evaluator.getType(enabled.name('ret', fn))!), type, fn);
        }
        const selections = enabled.events.flatMap((e) => (e.kind === 'selection' ? [e] : []));
        const prefix = selections.find((e) => getEnclosingFunction(e.node)?.d.name.d.value === 'prefix')!;
        assert.equal(prefix.selection.reason, 'unsupported-return-shape');
        assert.deepStrictEqual(prefix.selection.candidates, []);
        const pair = selections.find((e) => getEnclosingFunction(e.node)?.d.name.d.value === 'original')!;
        assert.deepStrictEqual(pair.selection.coverage, ['not-covered', 'not-covered']);
        assert.equal(
            selections.find((e) => getEnclosingFunction(e.node)?.d.name.d.value === 'equal_returns')!.selection.reason,
            'equivalent-or-single-return'
        );
        const original = inFunction(actual, 'original');
        assert.deepStrictEqual(
            original.filter((d) => d.rule === 'reportInvalidTypeForm'),
            inFunction(expected, 'original').filter((d) => d.rule === 'reportInvalidTypeForm')
        );
        assert.equal(original.filter((d) => d.rule === 'reportAssertTypeFailure').length, 2);
        assert.ok(original.some((d) => d.message.includes('OverloadResult[list[int], list[str]]')));
        for (const text of ['ret.append(3.14)', 'ret.nonexistent()', 'invalid: list[bytes]', 'unrelated: int']) {
            const line = source.slice(0, source.indexOf(text)).split('\n').length - 1;
            assert.deepStrictEqual(
                actual.filter((d) => d.range.start.line === line),
                expected.filter((d) => d.range.start.line === line),
                text
            );
        }
        assert.deepStrictEqual(enabled.info.getFileInfo(enabled.module).diagnosticSink.fetchAndClear(), []);
    } finally {
        ordinary.dispose();
        enabled.dispose();
    }
});

test('AutomaticOverloadResult uses the internal Program opt-in without an injected seed provider', () => {
    const test = create(readSampleFile('overloadResultAutomatic1.py'), false);
    try {
        test.config.experimentalOverloadResults = true;
        test.program.setConfigOptions(test.config);
        test.analyze();
        const controller = test.program.experimentalOverloadResultController!;
        assert.ok(isOverloadResult(test.program.evaluator!.getType(test.name('ret', 'original'))!));
        assert.ok(controller.getAutomaticStats().selected > 0);
    } finally {
        test.dispose();
    }
});

test.each(['check-first', 'value-first', 'use-first'])(
    'AutomaticOverloadResult gradual returns preserve exact ordinary errors: %s',
    (order) => {
        const source = readSampleFile('overloadResultDynamicReturns1.py');
        const ordinary = create(source, false);
        const automatic = create(source, false, true);
        const expected = [
            {
                category: DiagnosticCategory.Error,
                rule: 'reportAttributeAccessIssue',
                message:
                    'Cannot access attribute "missing_member" for class "list[int]"\n' +
                    '\u00a0\u00a0Attribute "missing_member" is unknown',
                range: { start: { line: 13, character: 8 }, end: { line: 13, character: 22 } },
            },
            {
                category: DiagnosticCategory.Error,
                rule: 'reportAttributeAccessIssue',
                message:
                    'Cannot access attribute "missing_member" for class "int"\n' +
                    '\u00a0\u00a0Attribute "missing_member" is unknown',
                range: { start: { line: 26, character: 14 }, end: { line: 26, character: 28 } },
            },
        ];
        const uses = (test: ReturnType<typeof create>) =>
            test.nodes.filter(
                (node): node is CallNode =>
                    node.nodeType === ParseNodeType.Call &&
                    node.d.leftExpr.nodeType === ParseNodeType.MemberAccess &&
                    node.d.leftExpr.d.member.d.value === 'missing_member'
            );
        try {
            for (const test of [ordinary, automatic]) {
                if (order === 'value-first') {
                    for (const fn of ['root_dynamic_return', 'nested_dynamic_return']) {
                        const type = test.program.evaluator!.getType(test.name('ret', fn))!;
                        assert.ok(!isOverloadResult(type));
                        assert.equal(test.program.evaluator!.printType(type), 'list[int]');
                    }
                } else if (order === 'use-first') {
                    uses(test).forEach((node) => test.program.evaluator!.getTypeOfExpression(node));
                }
            }
            assert.deepStrictEqual(ordinary.analyze(), expected);
            assert.deepStrictEqual(automatic.analyze(), expected);
            const evaluator = automatic.program.evaluator!;
            const controller = automatic.program.experimentalOverloadResultController!;
            assert.equal(controller.getAutomaticStats().selected, 0);
            assert.equal(controller.getAutomaticStats().reasons['unsupported-return-shape'], 2);
            const selections = controller.getAutomaticStats().selections;
            for (let round = 0; round < 3; round++) {
                controller.evict(automatic.module);
                for (const fn of ['root_dynamic_return', 'nested_dynamic_return']) {
                    const target = automatic.name('ret', fn);
                    evaluator.evaluateTypesForStatement(target.parent!);
                    assert.equal(evaluator.printType(evaluator.getCachedType(target)!), 'list[int]');
                    assert.deepStrictEqual(
                        resultSummary(evaluator, evaluator.getTypeOfExpression(target)),
                        resultSummary(
                            ordinary.program.evaluator!,
                            ordinary.program.evaluator!.getTypeOfExpression(ordinary.name('ret', fn))
                        )
                    );
                    assert.ok(!isOverloadResult(evaluator.getType(target)!));
                    assert.ok(!isOverloadResult(evaluator.getTypeResult(target)!.type));
                }
                uses(automatic).forEach((node, index) =>
                    assert.deepStrictEqual(
                        resultSummary(evaluator, evaluator.getTypeOfExpression(node)),
                        resultSummary(
                            ordinary.program.evaluator!,
                            ordinary.program.evaluator!.getTypeOfExpression(uses(ordinary)[index])
                        )
                    )
                );
                assert.deepStrictEqual(automatic.info.getFileInfo(automatic.module).diagnosticSink.fetchAndClear(), []);
                assert.deepStrictEqual(automatic.analyze(), expected);
                assert.equal(controller.getAutomaticStats().selections, selections);
            }
        } finally {
            ordinary.dispose();
            automatic.dispose();
        }
    }
);

test.each(['int', 'str'])('AutomaticOverloadResult static covering prefix retains %s before object', (first) => {
    const second = first === 'int' ? 'str' : 'int';
    const source = `from typing import Any, overload
@overload
def choose(value: list[${first}]) -> list[${first}]: ...
@overload
def choose(value: list[Any]) -> object: ...
@overload
def choose(value: list[${second}]) -> list[${second}]: ...
def choose(value: Any) -> Any:
    return value
def positive(value: list[Any]):
    ret = choose(value)
    ret.clear()
    ret.append(3.14)
`;
    const ordinary = create(source, false);
    const automatic = create(source, { automatic: true });
    try {
        assert.deepStrictEqual(automatic.analyze(), ordinary.analyze());
        const evaluator = automatic.program.evaluator!;
        assert.equal(
            evaluator.printType(evaluator.getType(automatic.name('ret'))!),
            `OverloadResult[list[${first}], object]`
        );
        const selection = automatic.events.find((e) => e.kind === 'selection');
        assert.ok(selection?.kind === 'selection');
        assert.deepStrictEqual(selection.selection.coverage, ['not-covered', 'covered']);
        assert.deepStrictEqual(selection.selection.matches, [0, 1]);
        assert.equal(selection.selection.candidates.length, 2);
    } finally {
        ordinary.dispose();
        automatic.dispose();
    }
});

test.each([
    'Any',
    'list[Any]',
    'list[list[Any]]',
    'dict[str, list[Any]]',
    'GradualAlias',
    'list',
    'list[list]',
    'list[int] | Any',
    'tuple[Any]',
    'Callable[..., Any]',
])('AutomaticOverloadResult rejects gradual or unsupported return %s before use-first queries', (returnType) => {
    const source = `from typing import Any, Callable, overload
GradualAlias = dict[str, list[Any]]
@overload
def choose(value: list[int]) -> list[int]: ...
@overload
def choose(value: list[str]) -> ${returnType}: ...
def choose(value: Any) -> Any:
    return value
def positive(value: list[Any]):
    ret = choose(value)
    ret.missing_member()
`;
    const ordinary = create(source, false);
    const automatic = create(source, false, true);
    try {
        const evaluator = automatic.program.evaluator!;
        const use = automatic.nodes.find(
            (node): node is CallNode =>
                node.nodeType === ParseNodeType.Call &&
                node.d.leftExpr.nodeType === ParseNodeType.MemberAccess &&
                node.d.leftExpr.d.member.d.value === 'missing_member'
        )!;
        evaluator.getTypeOfExpression(use);
        assert.deepStrictEqual(automatic.analyze(), ordinary.analyze());
        assert.ok(automatic.analyze().some((d) => d.rule === 'reportAttributeAccessIssue'));
        assert.equal(automatic.program.experimentalOverloadResultController!.getAutomaticStats().selected, 0);
        assert.equal(evaluator.printType(evaluator.getType(automatic.name('ret'))!), 'list[int]');
        assert.deepStrictEqual(
            resultSummary(evaluator, evaluator.getTypeOfExpression(automatic.name('ret'))),
            resultSummary(
                ordinary.program.evaluator!,
                ordinary.program.evaluator!.getTypeOfExpression(ordinary.name('ret'))
            )
        );
        assert.deepStrictEqual(automatic.info.getFileInfo(automatic.module).diagnosticSink.fetchAndClear(), []);
    } finally {
        ordinary.dispose();
        automatic.dispose();
    }
});

test('AutomaticOverloadResult original implicit reveal reports the actual canonical value', () => {
    const source = readSampleFile('overloadCall11.py');
    const ordinary = create(source, false);
    const automatic = create(source, { automatic: true });
    try {
        assert.equal(ordinary.analyze().filter((d) => d.category === DiagnosticCategory.Error).length, 2);
        const actual = automatic.analyze();
        const evaluator = automatic.program.evaluator!;
        assert.equal(
            evaluator.printType(evaluator.getType(automatic.name('result', 'check'))!),
            'OverloadResult[list[int], list[str]]'
        );
        assert.ok(actual.some((d) => d.message.includes('OverloadResult[list[int], list[str]]')));
        assert.equal(actual.filter((d) => d.category === DiagnosticCategory.Error).length, 1);
        assert.ok(!actual.some((d) => d.rule === 'reportAssignmentType' || d.rule === 'reportArgumentType'));
    } finally {
        ordinary.dispose();
        automatic.dispose();
    }
});

test.each([false, true])('AutomaticOverloadResult public subnode queries queryFirst=%s', (queryFirst) => {
    const source = `from typing import Any, overload, reveal_type
@overload
def choose(value: list[int]) -> list[int]: ...
@overload
def choose(value: list[str]) -> list[str]: ...
def choose(value: Any) -> Any:
    return value
def ordinary(value: list[int]):
    ret = choose(value)
    reveal_type(ret)
    ret.append(1)
def active(value: list[Any]):
    ret = choose(value)
    reveal_type(ret)
    ret.append(1)
`;
    const ordinary = create(source, false);
    const automatic = create(source, false, true);
    try {
        if (!queryFirst) {
            ordinary.analyze();
            automatic.analyze();
        }
        const evaluator = automatic.program.evaluator!;
        const readerArgument = automatic.name('ret', 'ordinary', 1);
        const baselineArgument = ordinary.name('ret', 'ordinary', 1);
        const readerResult = evaluator.getTypeResult(readerArgument);
        const baselineResult = ordinary.program.evaluator!.getTypeResult(baselineArgument);
        assert.ok(readerResult && baselineResult);
        assert.deepStrictEqual(
            resultSummary(evaluator, readerResult),
            resultSummary(ordinary.program.evaluator!, baselineResult)
        );
        assert.equal(evaluator.printType(evaluator.getType(readerArgument)!), 'list[int]');
        const member = automatic.name('append', 'active');
        const parent = member.parent!;
        assert.ok(parent.nodeType === ParseNodeType.MemberAccess);
        assert.strictEqual(evaluator.getType(member), evaluator.getType(parent));
        assert.strictEqual(evaluator.getTypeResult(member), evaluator.getTypeResult(parent));
        assert.ok(isOverloadResult(evaluator.getType(member)!));
        const position = (node: NameNode) => {
            const before = source.slice(0, node.start);
            return { line: before.split('\n').length - 1, character: node.start - before.lastIndexOf('\n') - 1 };
        };
        for (const [node, expected] of [
            [readerArgument, 'list[int]'],
            [member, 'OverloadResult'],
        ] as const) {
            const hover = new HoverProvider(
                automatic.program,
                automatic.uri,
                position(node),
                'markdown',
                CancellationToken.None
            ).getHover();
            assert.ok(JSON.stringify(hover).includes(expected));
            assert.ok(!JSON.stringify(hover).includes('Unknown'));
        }
        const expectedDiagnostics = automatic.analyze();
        for (let i = 0; i < 3; i++) {
            automatic.program.experimentalOverloadResultController!.evict(automatic.module);
            evaluator.evaluateTypesForStatement(automatic.name('ret', 'ordinary').parent!);
            evaluator.evaluateTypesForStatement(automatic.name('ret', 'active').parent!);
            assert.equal(evaluator.printType(evaluator.getType(readerArgument)!), 'list[int]');
            assert.strictEqual(evaluator.getType(member), evaluator.getType(parent));
            assert.deepStrictEqual(automatic.analyze(), expectedDiagnostics);
            assert.deepStrictEqual(automatic.info.getFileInfo(automatic.module).diagnosticSink.fetchAndClear(), []);
        }
        assert.equal(automatic.program.experimentalOverloadResultController!.getAutomaticStats().selected, 1);
    } finally {
        ordinary.dispose();
        automatic.dispose();
    }
});

test.each([false, true])('AutomaticOverloadResult implicit reader type roles queryFirst=%s', (queryFirst) => {
    const header = fixture.slice(0, fixture.indexOf('def project'));
    const source =
        header.replace(', reveal_type', '') +
        `
def positive(value: list[Any]):
    ret = choose(value)
    reveal_type(ret, expected_type=list[int])
    reveal_type(1, expected_type=ret)
    ret.append("x")
`;
    const ordinary = create(source, false);
    const automatic = create(source, { automatic: true });
    try {
        if (queryFirst) {
            automatic.program.evaluator!.getType(automatic.name('ret'));
        }
        const expected = ordinary.analyze();
        const actual = automatic.analyze();
        const invalid = expected.filter((d) => d.rule === 'reportInvalidTypeForm');
        assert.equal(invalid.length, 1);
        assert.deepStrictEqual(
            actual.filter((d) => d.rule === 'reportInvalidTypeForm'),
            invalid
        );
        assert.ok(actual.some((d) => d.message.includes('OverloadResult[list[int], list[str]]')));
        assert.ok(!actual.some((d) => d.rule === 'reportArgumentType'));
    } finally {
        ordinary.dispose();
        automatic.dispose();
    }
});

test.each([
    'constructor12.py',
    'constructor34.py',
    'protocol54.py',
    'typeVarDefaultClass5.py',
    'typeVarDefaultClass6.py',
    'overloadCall6.py',
    'overloadCall12.py',
])('AutomaticOverloadResult preserves complete ordinary source diagnostics for %s', (sample) => {
    const source = readSampleFile(sample);
    const ordinary = create(source, false);
    const automatic = create(source, { automatic: true });
    try {
        assert.deepStrictEqual(automatic.analyze(), ordinary.analyze());
        assert.equal(automatic.program.experimentalOverloadResultController!.getAutomaticStats().selected, 0);
        if (sample === 'constructor34.py') {
            assert.equal(automatic.analyze().filter((d) => d.category === DiagnosticCategory.Error).length, 6);
        }
    } finally {
        ordinary.dispose();
        automatic.dispose();
    }
});

test('AutomaticOverloadResult proof cutoff and zero consumer discovery preserve ordinary contracts', () => {
    const source = readSampleFile('overloadResultAutomatic1.py');
    const ordinary = create(source, false);
    const cutoff = create(source, { automatic: true, limits: { proofUnits: 1 } });
    const zero = create(source, { automatic: true, consumerCalls: 0 });
    try {
        assert.deepStrictEqual(cutoff.analyze(), ordinary.analyze());
        assert.ok(cutoff.events.some((e) => e.kind === 'selection' && e.selection.reason === 'proof-limit'));
        const expectedTypeName = (test: ReturnType<typeof create>) =>
            test.nodes.find(
                (node): node is NameNode =>
                    node.nodeType === ParseNodeType.Name &&
                    node.start === source.indexOf('assert_type(1, ret)') + 'assert_type(1, '.length
            )!;
        const ordinaryResult = ordinary.program.evaluator!.getTypeOfExpression(expectedTypeName(ordinary));
        const cutoffResult = cutoff.program.evaluator!.getTypeOfExpression(expectedTypeName(cutoff));
        assert.equal(ordinary.program.evaluator!.printType(ordinaryResult.type), 'Unknown');
        assert.deepStrictEqual(
            resultSummary(cutoff.program.evaluator!, cutoffResult),
            resultSummary(ordinary.program.evaluator!, ordinaryResult)
        );
        for (let i = 0; i < 3; i++) {
            cutoff.program.experimentalOverloadResultController!.evict(cutoff.module);
            cutoff.program.evaluator!.evaluateTypesForStatement(cutoff.name('ret', 'original').parent!);
            assert.deepStrictEqual(
                resultSummary(
                    cutoff.program.evaluator!,
                    cutoff.program.evaluator!.getTypeOfExpression(expectedTypeName(cutoff))
                ),
                resultSummary(ordinary.program.evaluator!, ordinaryResult)
            );
            assert.equal(
                cutoff.program.evaluator!.printType(cutoff.program.evaluator!.getType(expectedTypeName(cutoff))!),
                'Unknown'
            );
            assert.deepStrictEqual(cutoff.info.getFileInfo(cutoff.module).diagnosticSink.fetchAndClear(), []);
        }
        zero.analyze();
        const evaluator = zero.program.evaluator!;
        const ret = evaluator.getType(zero.name('ret', 'original'));
        assert.ok(ret && isOverloadResult(ret));
        assert.strictEqual(evaluator.getType(zero.name('alias', 'original')), ret);
    } finally {
        ordinary.dispose();
        cutoff.dispose();
        zero.dispose();
    }
});

test('AutomaticOverloadResult reversed overloads retain generic projection and both scalar member witnesses', () => {
    const source = fixture
        .replace(/\r\n/g, '\n')
        .replace(
            'def choose(value: list[int]) -> list[int]: ...\n@overload\ndef choose(value: list[str]) -> list[str]: ...',
            'def choose(value: list[str]) -> list[str]: ...\n@overload\ndef choose(value: list[int]) -> list[int]: ...'
        );
    const fixed = create(source);
    const automatic = create(source, { automatic: true });
    try {
        assert.deepStrictEqual(automatic.analyze(), fixed.analyze());
        const evaluator = automatic.program.evaluator!;
        for (const [name, type] of [
            ['ret', 'OverloadResult[list[str], list[int]]'],
            ['projected', 'OverloadResult[Sequence[str], Sequence[int]]'],
            ['scalar', 'OverloadResult[str, int]'],
        ]) {
            assert.equal(evaluator.printType(evaluator.getType(automatic.name(name))!), type);
        }
    } finally {
        fixed.dispose();
        automatic.dispose();
    }
});

test('OverloadResultController installed without seeds preserves complete ordinary diagnostics and types', () => {
    const ordinary = create(fixture, false);
    const empty = create(fixture, { seeds: () => [] });
    try {
        assert.deepStrictEqual(empty.analyze(), ordinary.analyze());
        for (const fn of ['positive', 'concrete', 'gradual', 'unknown', 'failed']) {
            const a = ordinary.program.evaluator!.getTypeOfExpression(ordinary.name('ret', fn));
            const b = empty.program.evaluator!.getTypeOfExpression(empty.name('ret', fn));
            assert.deepStrictEqual(
                resultSummary(empty.program.evaluator!, b),
                resultSummary(ordinary.program.evaluator!, a)
            );
        }
        assert.equal(empty.events.length, 0);
        assert.equal(empty.program.experimentalOverloadResultController!.getStats(empty.module), undefined);
    } finally {
        ordinary.dispose();
        empty.dispose();
    }
});

test('OverloadResultController canonical queries, aliases and actual assignment reentry', () => {
    const test = create();
    try {
        const diagnostics = test.analyze();
        const evaluator = test.program.evaluator!;
        const alias = test.name('alias');
        const canonical = evaluator.getTypeOfExpression(alias).type;
        assert.ok(isOverloadResult(canonical));
        assert.strictEqual(evaluator.getType(test.name('ret')), canonical);
        assert.strictEqual(evaluator.getType(alias), canonical);
        assert.strictEqual(evaluator.getTypeResult(alias)!.type, canonical);
        assert.equal(evaluator.printType(evaluator.getType(test.name('string'))!), 'list[str]');
        assert.ok(isOverloadResult(evaluator.getType(test.name('projected'))!));
        assert.ok(isOverloadResult(evaluator.getType(test.name('scalar'))!));
        const offset = fixture.slice(0, alias.start);
        const hover = new HoverProvider(
            test.program,
            test.uri,
            {
                line: offset.split('\n').length - 1,
                character: offset.length - offset.lastIndexOf('\n') - 1,
            },
            'markdown',
            CancellationToken.None
        ).getHover();
        assert.ok(JSON.stringify(hover).includes('OverloadResult'));
        const controller = test.program.experimentalOverloadResultController!;
        const target = test.name('string');
        assert.ok(target.parent?.nodeType === ParseNodeType.TypeAnnotation);
        const assignment = target.parent.parent;
        assert.ok(assignment?.nodeType === ParseNodeType.Assignment);
        const before = controller.getStats(test.module)!;
        for (let round = 0; round < 3; round++) {
            controller.evict(test.module);
            assert.equal(evaluator.getCachedType(target), undefined);
            evaluator.evaluateTypesForStatement(alias.parent!);
            evaluator.evaluateTypesForStatement(assignment);
            assert.equal(evaluator.printType(evaluator.getCachedType(target)!), 'list[str]');
            assert.ok(!isOverloadResult(evaluator.getCachedType(alias)!));
            assert.strictEqual(evaluator.getType(alias), canonical);
        }
        assert.deepStrictEqual(test.info.getFileInfo(test.module).diagnosticSink.fetchAndClear(), []);
        const after = controller.getStats(test.module)!;
        assert.equal(before.candidateCalls, after.candidateCalls);
        assert.equal(before.outcomes, after.outcomes);
        assert.ok(after.ordinaryRequests > before.ordinaryRequests);
        assert.deepStrictEqual(test.analyze(), diagnostics);
        assert.ok(diagnostics.some((d) => d.rule === 'reportAssignmentType'));
        assert.ok(diagnostics.some((d) => d.rule === 'reportAttributeAccessIssue'));
    } finally {
        test.dispose();
    }
});

test('OverloadResultController declines unsupported uses before early queries in both orders', () => {
    const normal = create(fixture, false);
    const forward = create();
    const reverse = create();
    try {
        const unsupported = ['repeated', 'escaped', 'captured', 'joined', 'returned', 'attribute', 'distinct'];
        for (const [test, names] of [
            [forward, unsupported],
            [reverse, [...unsupported].reverse()],
        ] as const) {
            for (const fn of names) {
                const node = test.name('ret', fn, 1);
                const result = test.program.evaluator!.getTypeOfExpression(node);
                const baseline = normal.program.evaluator!.getTypeOfExpression(normal.name('ret', fn, 1));
                assert.ok(!isOverloadResult(result.type));
                assert.deepStrictEqual(
                    resultSummary(test.program.evaluator!, result),
                    resultSummary(normal.program.evaluator!, baseline)
                );
            }
            assert.ok(isOverloadResult(test.program.evaluator!.getType(test.name('independent', 'repeated'))!));
        }
        assert.deepStrictEqual(forward.analyze(), reverse.analyze());
        assert.equal(forward.events.filter((e) => e.kind === 'admission').length, 1);
        const base = normal.analyze();
        const enabled = forward.analyze();
        for (const d of enabled.filter((d) => d.range.start.line >= 46)) {
            assert.ok(base.some((b) => JSON.stringify(b) === JSON.stringify(d)));
        }
    } finally {
        normal.dispose();
        forward.dispose();
        reverse.dispose();
    }
});

test.each([false, true])('OverloadResultController genuine expected contexts automatic=%s', (automatic) => {
    const test = create(fixture, { automatic });
    try {
        const initial = test.analyze();
        const evaluator = test.program.evaluator!;
        const alias = test.name('alias');
        const canonical = evaluator.getType(alias)!;
        const expected = evaluator.getType(test.name('string'))!;
        const call = test.nodes.find(
            (n): n is CallNode =>
                n.nodeType === ParseNodeType.Call &&
                n.d.leftExpr.nodeType === ParseNodeType.Name &&
                n.d.leftExpr.d.value === 'project' &&
                getEnclosingFunction(n)?.d.name.d.value === 'positive'
        )!;
        const stableCall = evaluator.getTypeOfExpression(call);
        const controller = test.program.experimentalOverloadResultController!;
        const before = controller.getStats(test.module)!;
        for (let round = 0; round < 8; round++) {
            for (const flags of [EvalFlags.None, EvalFlags.NoSpecialize]) {
                assert.strictEqual(
                    evaluator.getTypeOfExpression(alias, flags, { expectedType: expected }).type,
                    canonical
                );
                const result = evaluator.getTypeOfExpression(call, flags, {
                    expectedType: expected,
                    isTypeIncomplete: true,
                });
                assert.ok(!isOverloadResult(result.type));
                assert.strictEqual(evaluator.getTypeOfExpression(call).type, stableCall.type);
            }
        }
        const after = controller.getStats(test.module)!;
        assert.equal(after.outcomes, before.outcomes);
        assert.equal(after.slots, before.slots);
        assert.equal(after.candidateCalls, before.candidateCalls);
        assert.equal(after.contextualRequests - before.contextualRequests, 16);
        assert.deepStrictEqual(test.info.getFileInfo(test.module).diagnosticSink.fetchAndClear(), []);
        assert.deepStrictEqual(test.analyze(), initial);
        const contextFirst = create(fixture, { automatic });
        try {
            const coldCall = contextFirst.nodes.find(
                (n): n is CallNode => n.nodeType === ParseNodeType.Call && n.start === call.start
            )!;
            const cold = contextFirst.program.evaluator!;
            const contextual = cold.getTypeOfExpression(coldCall, EvalFlags.NoSpecialize, {
                expectedType: AnyType.create(),
                isTypeIncomplete: true,
            });
            assert.ok(!isOverloadResult(contextual.type));
            assert.deepStrictEqual(
                contextFirst.info.getFileInfo(contextFirst.module).diagnosticSink.fetchAndClear(),
                []
            );
            assert.deepStrictEqual(contextFirst.analyze(), initial);
            assert.equal(cold.printType(cold.getTypeOfExpression(coldCall).type), evaluator.printType(stableCall.type));
        } finally {
            contextFirst.dispose();
        }
    } finally {
        test.dispose();
    }
});

test('OverloadResultController zero limits preserve ordinary errors and zero consumer budget preserves aliases', () => {
    const normal = create(fixture, false);
    const zero = create(fixture, { limits: { candidates: 0 } });
    const alias = create(fixture, { consumerCalls: 0 });
    try {
        assert.deepStrictEqual(zero.analyze(), normal.analyze());
        alias.analyze();
        const ev = alias.program.evaluator!;
        assert.ok(isOverloadResult(ev.getType(alias.name('ret'))!));
        assert.strictEqual(ev.getType(alias.name('ret')), ev.getType(alias.name('alias')));
        const cutoffs = zero.events.filter((e) => e.kind === 'value' && e.cutoff);
        assert.ok(cutoffs.length);
        for (const event of cutoffs) {
            if (event.kind === 'value') {
                assert.strictEqual(event.canonical, event.baseline);
            }
        }
    } finally {
        normal.dispose();
        zero.dispose();
        alias.dispose();
    }
});

test('OverloadResultController unsupported flags and root alternative contexts use complete ordinary operations', () => {
    const enabled = create();
    try {
        const initial = enabled.analyze();
        const evaluator = enabled.program.evaluator!;
        const canonical = evaluator.getType(enabled.name('alias'))!;
        assert.ok(isOverloadResult(canonical));
        const findCall = (nodes: ParseNode[]) =>
            nodes.find(
                (n): n is CallNode =>
                    n.nodeType === ParseNodeType.Call &&
                    n.d.leftExpr.nodeType === ParseNodeType.Name &&
                    n.d.leftExpr.d.value === 'project' &&
                    getEnclosingFunction(n)?.d.name.d.value === 'positive'
            )!;
        const call = findCall(enabled.nodes);
        const controller = enabled.program.experimentalOverloadResultController!;
        const before = controller.getStats(enabled.module)!;
        for (const flags of [EvalFlags.TypeExpression, EvalFlags.TypeFormArg, EvalFlags.ForwardRefs]) {
            for (const node of [enabled.name('alias'), call]) {
                controller.evict(enabled.module);
                const result = evaluator.getTypeOfExpression(node, flags, {
                    expectedType: canonical,
                    returnTypeOverride: canonical,
                    isTypeIncomplete: true,
                });
                assert.ok(!isOverloadResult(result.type));
                // An owned contextual operation has fresh selected caches. Compare
                // with a cold ordinary request, not a cached context-free answer.
                const ordinary = create(fixture, false);
                try {
                    const baselineEvaluator = ordinary.program.evaluator!;
                    const baseline = baselineEvaluator.getTypeOfExpression(
                        node === call ? findCall(ordinary.nodes) : ordinary.name('alias'),
                        flags,
                        {
                            expectedType: baselineEvaluator.getType(ordinary.name('ret'))!,
                            returnTypeOverride: baselineEvaluator.getType(ordinary.name('ret'))!,
                            isTypeIncomplete: true,
                        }
                    );
                    assert.deepStrictEqual(
                        resultSummary(evaluator, result),
                        resultSummary(baselineEvaluator, baseline)
                    );
                    const trials = enabled.events.filter((e) => e.kind === 'trial' && e.mode === 'context');
                    const trial = trials[trials.length - 1];
                    assert.ok(trial.kind === 'trial');
                    const diagnostic = (d: Diagnostic) => ({
                        category: d.category,
                        message: d.message,
                        range: d.range,
                        rule: d.getRule(),
                    });
                    assert.deepStrictEqual(
                        trial.diagnostics.map(diagnostic),
                        ordinary.info.getFileInfo(ordinary.module).diagnosticSink.fetchAndClear().map(diagnostic)
                    );
                } finally {
                    ordinary.dispose();
                }
                assert.strictEqual(evaluator.getType(enabled.name('alias')), canonical);
            }
        }
        const after = controller.getStats(enabled.module)!;
        assert.equal(after.outcomes, before.outcomes);
        assert.equal(after.candidateCalls, before.candidateCalls);
        assert.equal(after.contextualRequests - before.contextualRequests, 6);
        assert.deepStrictEqual(enabled.info.getFileInfo(enabled.module).diagnosticSink.fetchAndClear(), []);
        assert.deepStrictEqual(enabled.analyze(), initial);
    } finally {
        enabled.dispose();
    }
});

test('OverloadResultController cutoff after successful member lookup preserves the complete ordinary operation', () => {
    const content = fixture
        .replace('scalar.upper()', 'unwrap(project(ret)).upper()')
        .replace('scalar.bit_length()', 'unwrap(project(ret)).bit_length()');
    const test = create(content, { consumerCalls: 3 });
    try {
        test.analyze();
        const calls = test.events.filter((e) => e.kind === 'beforeCall' && e.mode === 'candidate');
        const resolved = calls.find(
            (e) =>
                e.kind === 'beforeCall' &&
                e.node.d.leftExpr.nodeType === ParseNodeType.MemberAccess &&
                e.node.d.leftExpr.d.member.d.value === 'bit_length' &&
                isFunction(e.seen.get(e.node.d.leftExpr)!.type)
        );
        assert.ok(resolved?.kind === 'beforeCall');
        assert.ok(
            test.events.some(
                (e) =>
                    e.kind === 'trial' &&
                    e.exception &&
                    e.mode === 'candidate' &&
                    e.root.start <= resolved.node.start &&
                    e.root.start + e.root.length >= resolved.node.start + resolved.node.length
            )
        );
        const cutoffs = test.events.filter((e) => e.kind === 'value' && e.cutoff);
        assert.ok(cutoffs.length);
        for (const e of cutoffs) {
            assert.ok(e.kind === 'value');
            assert.strictEqual(e.canonical, e.baseline);
        }
        assert.deepStrictEqual(test.info.getFileInfo(test.module).diagnosticSink.fetchAndClear(), []);
    } finally {
        test.dispose();
    }
});

test.each([false, true])('OverloadResultController cancelled discovery restores state automatic=%s', (automatic) => {
    let fault = true;
    const test = create(fixture, {
        automatic,
        observe(event) {
            if (fault && event.kind === 'beforeCall' && event.mode === 'candidate') {
                fault = false;
                throw new OperationCanceledException();
            }
        },
    });

    try {
        const evaluator = test.program.evaluator!;
        assert.throws(
            () => evaluator.getType(test.name('ret')),
            (error) => OperationCanceledException.is(error)
        );
        assert.equal(evaluator.getCachedType(test.name('ret')), undefined);
        assert.deepStrictEqual(test.info.getFileInfo(test.module).diagnosticSink.fetchAndClear(), []);
        assert.ok(isOverloadResult(evaluator.getType(test.name('ret'))!));
        assert.ok(test.program.experimentalOverloadResultController!.getStats(test.module)!.retryReservations > 0);
        test.analyze();
        const controller = test.program.experimentalOverloadResultController!;
        test.dispose();
        assert.equal(controller.getStats(test.module), undefined);
        assert.throws(() => evaluator.getType(test.name('ret')), /Retired overload-result controller/);
    } finally {
        test.dispose();
    }
});

test.each([
    '    ret += [1]',
    '    while condition:\n        ret = [b"changed"]\n    ret.append("late")',
    '    alias = ret\n    print(ret, alias)',
    '    second = choose(ret)\n    second.append("late")',
    '    storage.append(ret)',
    '    box.field = ret',
])('OverloadResultController unsupported local path declines before publication: %s', (suffix) => {
    const source =
        fixture +
        '\n\ndef tail(value: list[Any], condition: bool, storage: list[list[int]], box: Box):\n' +
        '    ret = choose(value)\n    ret.append("early")\n' +
        suffix +
        '\n';
    const ordinary = create(source, false);
    const enabled = create(source);
    try {
        const result = enabled.program.evaluator!.getTypeOfExpression(enabled.name('ret', 'tail', 1));
        assert.ok(!isOverloadResult(result.type));
        const startLine = source.slice(0, source.indexOf('def tail')).split('\n').length - 1;
        const baseline = ordinary.analyze().filter((d) => d.range.start.line >= startLine);
        const actual = enabled.analyze().filter((d) => d.range.start.line >= startLine);
        assert.deepStrictEqual(actual, baseline);
        assert.ok(isOverloadResult(enabled.program.evaluator!.getType(enabled.name('independent', 'repeated'))!));
    } finally {
        ordinary.dispose();
        enabled.dispose();
    }
});

test('OverloadResultController materialization faults restore selected caches and live diagnostic ownership', () => {
    let fault: 'error' | 'cancel' | undefined;
    const test = create(fixture, {
        observe(event) {
            if (fault && event.kind === 'project' && event.mode === 'materialize-witness') {
                const current = fault;
                fault = undefined;
                if (current === 'cancel') {
                    throw new OperationCanceledException();
                }
                throw new Error('materialization interruption');
            }
        },
    });
    try {
        const original = test.analyze();
        const evaluator = test.program.evaluator!;
        const target = test.name('string');
        assert.ok(target.parent?.nodeType === ParseNodeType.TypeAnnotation);
        const statement = target.parent.parent;
        assert.ok(statement?.nodeType === ParseNodeType.Assignment);
        const canonical = evaluator.getType(test.name('alias'));
        const sink = test.info.getFileInfo(test.module).diagnosticSink;
        for (const kind of ['error', 'cancel'] as const) {
            test.program.experimentalOverloadResultController!.evict(test.module);
            fault = kind;
            assert.throws(
                () => evaluator.evaluateTypesForStatement(statement),
                (error) =>
                    kind === 'cancel'
                        ? OperationCanceledException.is(error)
                        : error instanceof Error && error.message === 'materialization interruption'
            );
            assert.strictEqual(test.info.getFileInfo(test.module).diagnosticSink, sink);
            assert.equal(evaluator.getCachedType(target), undefined);
            assert.deepStrictEqual(sink.fetchAndClear(), []);
            assert.ok(!evaluator.isSpeculativeModeInUse(undefined));
            evaluator.evaluateTypesForStatement(statement);
            assert.equal(evaluator.printType(evaluator.getCachedType(target)!), 'list[str]');
            assert.strictEqual(evaluator.getType(test.name('alias')), canonical);
        }
        assert.deepStrictEqual(test.analyze(), original);
    } finally {
        test.dispose();
    }
});

test.each([false, true])('OverloadResultController discovery limits automatic=%s', (automatic) => {
    const exact = create(fixture, { automatic, limits: { candidates: 2 } });
    const over = create(fixture, { automatic, limits: { candidates: 1 } });
    const zeroGraph = create(fixture, { automatic, limits: { graphUnits: 0 } });
    const ordinary = create(fixture, false);
    try {
        assert.ok(isOverloadResult(exact.program.evaluator!.getType(exact.name('ret'))!));
        const baseline = ordinary.analyze();
        assert.deepStrictEqual(over.analyze(), baseline);
        assert.deepStrictEqual(zeroGraph.analyze(), baseline);
        assert.ok(!isOverloadResult(over.program.evaluator!.getType(over.name('ret'))!));
        assert.equal(
            zeroGraph.program.experimentalOverloadResultController!.getStats(zeroGraph.module)!.candidateCalls,
            0
        );
    } finally {
        exact.dispose();
        over.dispose();
        zeroGraph.dispose();
        ordinary.dispose();
    }
});

test.each([false, true])('OverloadResultController source replacement automatic=%s', (automatic) => {
    const test = create(fixture, { automatic });
    try {
        const diagnostics = test.analyze();
        const old = test.program.evaluator!;
        const alias = test.name('alias');
        const value = old.getType(alias);
        test.program.setFileOpened(test.uri, 2, fixture.replace('ret = choose(value)', 'ret = [b"edited"]'));
        test.analyze();
        assert.ok(test.events.some((event) => event.kind === 'retire'));
        test.program.setFileOpened(test.uri, 3, fixture);
        assert.deepStrictEqual(test.analyze(), diagnostics);
        const nodes = new Nodes();
        nodes.walk(test.program.getParseResults(test.uri)!.parserOutput.parseTree);
        const restored = nodes.nodes.find(
            (n): n is NameNode =>
                n.nodeType === ParseNodeType.Name &&
                n.d.value === 'alias' &&
                getEnclosingFunction(n)?.d.name.d.value === 'positive'
        )!;
        const current = test.program.evaluator!.getType(restored);
        assert.ok(current && isOverloadResult(current));
        assert.notStrictEqual(current, value);
        assert.throws(
            () => old.getType(alias),
            /Retired overload-result controller|Expired overload-result parse generation/
        );
    } finally {
        test.dispose();
    }
});

const readerFixture = readSampleFile('overloadResultReader1.py');
const readerOrders = ['check-first', 'value-first', 'reader-first'] as const;

test.each(readerOrders.flatMap((order) => [false, true].map((automatic) => ({ order, automatic }))))(
    'OverloadResultController reader type argument preserves ordinary errors: %j',
    ({ order, automatic }) => {
        const ordinary = create(readerFixture, false);
        const enabled = create(readerFixture, { automatic });
        const expected = [
            {
                category: DiagnosticCategory.Error,
                rule: 'reportInvalidTypeForm',
                message: 'Variable not allowed in type expression',
                range: { start: { line: 13, character: 19 }, end: { line: 13, character: 22 } },
            },
            {
                category: DiagnosticCategory.Error,
                rule: 'reportAssertTypeFailure',
                message: '"assert_type" mismatch: expected "Unknown" but received "Literal[1]"',
                range: { start: { line: 13, character: 16 }, end: { line: 13, character: 17 } },
            },
        ];
        const reader = (test: ReturnType<typeof create>) =>
            test.nodes.find(
                (n): n is CallNode =>
                    n.nodeType === ParseNodeType.Call && n.start === readerFixture.indexOf('assert_type(1, ret)')
            )!;
        try {
            for (const test of [ordinary, enabled]) {
                if (order === 'value-first') {
                    test.program.evaluator!.getType(test.name('ret', 'invalid_expected_type'));
                } else if (order === 'reader-first') {
                    test.program.evaluator!.getTypeOfExpression(reader(test));
                }
            }
            assert.deepStrictEqual(ordinary.analyze(), expected);
            assert.deepStrictEqual(enabled.analyze(), expected);
            const evaluator = enabled.program.evaluator!;
            const value = evaluator.getType(enabled.name('ret', 'invalid_expected_type'));
            assert.ok(value && isOverloadResult(value));
            assert.deepStrictEqual(
                resultSummary(evaluator, evaluator.getTypeOfExpression(reader(enabled))),
                resultSummary(
                    ordinary.program.evaluator!,
                    ordinary.program.evaluator!.getTypeOfExpression(reader(ordinary))
                )
            );
            assert.ok(
                enabled.events.some(
                    (e) =>
                        e.kind === 'trial' &&
                        e.mode === 'reader' &&
                        e.diagnostics.some((d) => d.getRule() === 'reportInvalidTypeForm')
                )
            );
            enabled.program.experimentalOverloadResultController!.evict(enabled.module);
            evaluator.evaluateTypesForStatement(reader(enabled));
            assert.strictEqual(evaluator.getType(enabled.name('ret', 'invalid_expected_type')), value);
            assert.deepStrictEqual(enabled.info.getFileInfo(enabled.module).diagnosticSink.fetchAndClear(), []);
            assert.deepStrictEqual(enabled.analyze(), expected);
        } finally {
            ordinary.dispose();
            enabled.dispose();
        }
    }
);

test.each([
    { statement: 'check_type(1, ret)', declined: false },
    { statement: 'show_type(1, expected_type=ret)', declined: false },
    { statement: 'alias = ret\n    check_type(1, alias)', declined: false },
    { statement: 'check_type(1, "ret")', declined: false },
    { statement: 'check_type(1, ret.__class__)', declined: true },
    { statement: 'check_type(ret.copy(), list[int])', declined: true },
    { statement: 'show_type(ret.copy())', declined: true },
    { statement: 'check_type(1, list[ret])', declined: true },
    { statement: 'check_type(ret, ret)', declined: true },
    { statement: 'reader = check_type\n    reader(1, ret)', declined: true },
    { statement: 'reader = check_type\n    reader(ret, list[int])', declined: true },
    { statement: 'reader = show_type\n    reader(ret)', declined: true },
    { statement: 'print(check_type(ret, list[int]))', declined: true },
    { statement: 'check_type(ret, list[int]).append(1)', declined: true },
])('OverloadResultController reader roles and aliases: $statement', ({ statement, declined }) => {
    const content = readerFixture
        .replace(
            'from typing import Any, assert_type, overload',
            'from typing import Any, assert_type as check_type, reveal_type as show_type, overload'
        )
        .replace('assert_type(1, ret)', statement);
    for (const order of readerOrders) {
        const ordinary = create(content, false);
        const enabled = create(content);
        const root = (test: ReturnType<typeof create>) =>
            test.nodes.find(
                (n): n is CallNode =>
                    n.nodeType === ParseNodeType.Call &&
                    n.start === content.lastIndexOf(statement.split('\n').pop()!.trim())
            )!;
        try {
            if (order === 'reader-first') {
                ordinary.program.evaluator!.getTypeOfExpression(root(ordinary));
                enabled.program.evaluator!.getTypeOfExpression(root(enabled));
            } else if (order === 'value-first') {
                ordinary.program.evaluator!.getType(ordinary.name('ret', 'invalid_expected_type'));
                const early = enabled.program.evaluator!.getType(enabled.name('ret', 'invalid_expected_type'));
                assert.ok(early);
                assert.equal(isOverloadResult(early), !declined);
            }
            assert.deepStrictEqual(enabled.analyze(), ordinary.analyze());
            assert.deepStrictEqual(
                resultSummary(
                    enabled.program.evaluator!,
                    enabled.program.evaluator!.getTypeOfExpression(root(enabled))
                ),
                resultSummary(
                    ordinary.program.evaluator!,
                    ordinary.program.evaluator!.getTypeOfExpression(root(ordinary))
                )
            );
            const value = enabled.program.evaluator!.getType(enabled.name('ret', 'invalid_expected_type'));
            assert.ok(value);
            assert.equal(isOverloadResult(value), !declined);
            assert.deepStrictEqual(enabled.info.getFileInfo(enabled.module).diagnosticSink.fetchAndClear(), []);
        } finally {
            ordinary.dispose();
            enabled.dispose();
        }
    }
});

test.each([false, true])(
    'OverloadResultController canonical reader value arguments remain exact, aliased=%s',
    (aliased) => {
        const assertName = aliased ? 'check_type' : 'assert_type';
        const revealName = aliased ? 'show_type' : 'reveal_type';
        const content = readerFixture
            .replace(
                'from typing import Any, assert_type, overload',
                `from typing import Any, assert_type${aliased ? ' as check_type' : ''}, reveal_type${
                    aliased ? ' as show_type' : ''
                }, overload`
            )
            .replace(
                'assert_type(1, ret)',
                `${assertName}(ret, list[int])\n    ${assertName}(ret, list[Any])\n    ${revealName}(ret)`
            );
        for (const order of readerOrders) {
            const ordinary = create(content, false);
            const enabled = create(content);
            try {
                if (order === 'value-first') {
                    enabled.program.evaluator!.getType(enabled.name('ret', 'invalid_expected_type'));
                } else if (order === 'reader-first') {
                    const calls = enabled.nodes.filter(
                        (n): n is CallNode =>
                            n.nodeType === ParseNodeType.Call &&
                            n.d.leftExpr.nodeType === ParseNodeType.Name &&
                            [assertName, revealName].includes(n.d.leftExpr.d.value)
                    );
                    for (const call of [...calls].reverse()) {
                        enabled.program.evaluator!.getTypeOfExpression(call);
                    }
                }
                const baseline = ordinary.analyze();
                const diagnostics = enabled.analyze();
                const value = enabled.program.evaluator!.getType(enabled.name('ret', 'invalid_expected_type'));
                assert.ok(value && isOverloadResult(value));
                assert.equal(diagnostics.length, 3);
                assert.equal(baseline.length, 2);
                assert.ok(diagnostics.every((d) => d.rule !== 'reportInvalidTypeForm'));
                assert.equal(
                    diagnostics[0].message,
                    '"assert_type" mismatch: expected "list[int]" but received "OverloadResult[list[int], list[str]]"'
                );
                assert.equal(
                    diagnostics[1].message,
                    '"assert_type" mismatch: expected "list[Any]" but received "OverloadResult[list[int], list[str]]"'
                );
                assert.equal(diagnostics[2].message, 'Type of "ret" is "OverloadResult[list[int], list[str]]"');
                const readers = enabled.nodes.filter(
                    (n): n is CallNode =>
                        n.nodeType === ParseNodeType.Call &&
                        n.d.leftExpr.nodeType === ParseNodeType.Name &&
                        [assertName, revealName].includes(n.d.leftExpr.d.value)
                );
                for (const call of readers) {
                    assert.strictEqual(
                        enabled.program.evaluator!.getTypeOfExpression(call, EvalFlags.NoSpecialize).type,
                        value
                    );
                }
                assert.deepStrictEqual(enabled.info.getFileInfo(enabled.module).diagnosticSink.fetchAndClear(), []);
            } finally {
                ordinary.dispose();
                enabled.dispose();
            }
        }
    }
);
