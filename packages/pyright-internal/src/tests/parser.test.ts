/*
 * parser.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for Python parser. These are very basic because
 * the parser gets lots of exercise in the type checker tests.
 */

import * as assert from 'assert';

import { AliasDeclaration, DeclarationType } from '../analyzer/declaration';
import { findNodeByOffset, getFirstAncestorOrSelfOfKind } from '../analyzer/parseTreeUtils';
import { ExecutionEnvironment, getStandardDiagnosticRuleSet } from '../common/configOptions';
import { DiagnosticSink } from '../common/diagnosticSink';
import { convertOffsetsToRange } from '../common/positionUtils';
import { pythonVersion3_13, pythonVersion3_14, pythonVersion3_15 } from '../common/pythonVersion';
import { getStringFingerprint } from '../common/stringUtils';
import { TextRange } from '../common/textRange';
import { UriEx } from '../common/uri/uriUtils';
import { LocMessage } from '../localization/localize';
import {
    getParserStringAnnotation,
    getParserStringAnnotationInfo,
    getNextNodeId,
    ParseNodeType,
    StatementListNode,
} from '../parser/parseNodes';
import { ParseOptions, Parser } from '../parser/parser';
import { parseTestData } from './harness/fourslash/fourSlashParser';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';
import { getRangeByMarkerName } from './harness/fourslash/testStateUtils';
import * as TestUtils from './testUtils';

test('Empty', () => {
    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseText('', diagSink).parserOutput;

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parserOutput.parseTree.d.statements.length, 0);
});

test.each([
    '[*group for group in groups]',
    '{*group for group in groups}',
    '{**part for part in parts}',
    '(*group for group in groups)',
    'consume(*group for group in groups)',
    'consume((*group for group in groups))',
    'consume(*(*group for group in groups))',
    '[*group for section in sections for group in section if group]',
    '[\n *group\n for group in groups\n if group\n]',
    '[*group for *group, last in groups]',
    '[*(captured := group) for group in groups]',
    '[*(group if enabled else ()) for group in groups]',
    '(*(group if enabled else ()) for group in groups)',
    '(*group if enabled else () for group in groups)',
    'consume(*group if enabled else () for group in groups)',
    '(*group if enabled else (captured := fallback) for group in groups)',
    'consume(*group if enabled else (captured := fallback) for group in groups)',
    '(*group or () for group in groups)',
    '(*not group for group in groups)',
    '(*group == other for group in groups)',
    '(*group is other for group in groups)',
    '(*group in others for group in groups)',
    '(*lambda: group for group in groups)',
    '{**part if enabled else {} for part in parts}',
    '{**part if enabled else (captured := fallback) for part in parts}',
    '{**part or {} for part in parts}',
    '{**not part for part in parts}',
    '{**part is other for part in parts}',
    '{**lambda: part for part in parts}',
    'async def inspect():\n    return [*group async for group in groups]',
    'async def inspect():\n    return {*group async for group in groups}',
    'async def inspect():\n    return {**part async for part in parts}',
    '(*group async for group in groups)',
    'consume(*group async for group in groups)',
    'async def inspect():\n    return (*await resolve(group) for group in groups)',
])('Python 3.15 comprehension unpacking grammar: %s', (source) => {
    const options = new ParseOptions();
    options.pythonVersion = pythonVersion3_15;
    const sink = new DiagnosticSink();
    TestUtils.parseText(source, sink, options);
    assert.deepStrictEqual(sink.getErrors(), []);
});

test.each([
    '[*group for group in groups]',
    '{*group for group in groups}',
    '{**part for part in parts}',
    '(*group for group in groups)',
    'consume(*group for group in groups)',
    'consume((*group for group in groups))',
])('Comprehension unpacking follows the stub syntax-version exemption: %s', (source) => {
    const options = new ParseOptions();
    options.pythonVersion = pythonVersion3_14;
    options.isStubFile = true;
    const sink = new DiagnosticSink();
    TestUtils.parseText(source, sink, options);
    assert.deepStrictEqual(sink.getErrors(), []);
});

test.each<[string, [string, string][]]>([
    ['[[|/*error0*/**part|] for part in parts]', [['error0', LocMessage.dictUnpackInList()]]],
    ['([|/*error0*/**part|] for part in parts)', [['error0', LocMessage.dictUnpackInGenerator()]]],
    ['consume[|/*error0*/(|]**part for part in parts)', [['error0', LocMessage.expectedCloseParen()]]],
    ['{[|/*error0*/*key|]: value for key, value in items}', [['error0', LocMessage.unpackInDict()]]],
    ['{key: [|/*error0*/*value|] for key, value in items}', [['error0', LocMessage.unpackInValue()]]],
    ['{[|/*error0*/**key|]: value for key, value in items}', [['error0', LocMessage.dictUnpackInKey()]]],
    ['{key: [|/*error0*/**value|] for key, value in items}', [['error0', LocMessage.dictUnpackInValue()]]],
    ['[|[/*error0*/|]*group if enabled else () for group in groups]', [['error0', LocMessage.expectedCloseBracket()]]],
    [
        '[|{/*error0*/|]*group if enabled else () [|/*error1*/for|] group in groups[|/*error2*/}|]',
        [
            ['error0', LocMessage.expectedCloseBrace()],
            ['error1', LocMessage.expectedNewlineOrSemicolon()],
            ['error2', LocMessage.expectedColon()],
        ],
    ],
    [
        '[|[/*error1*/|]group if enabled else [|/*error0*/*|]other for group in groups]',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseBracket()],
        ],
    ],
    [
        '[|[/*error2*/|][|/*error1*/(|]group if enabled else [|/*error0*/*|]other) for group in groups]',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseParen()],
            ['error2', LocMessage.expectedCloseBracket()],
        ],
    ],
    ['[([|/*error0*/*group|]) for group in groups]', [['error0', LocMessage.unpackOperatorNotAllowed()]]],
    ['[*first, [|/*error0*/*group for group in groups|]]', [['error0', LocMessage.comprehensionInSequence()]]],
    ['[first, [|/*error0*/group for group in groups|]]', [['error0', LocMessage.comprehensionInSequence()]]],
    ['(first, [|/*error0*/*group for group in groups|])', [['error0', LocMessage.comprehensionInSequence()]]],
    ['{**first, **[|/*error0*/part|] for part in parts}', [['error0', LocMessage.comprehensionInDict()]]],
    ['consume([|/*error0*/*group for group in groups|],)', [['error0', LocMessage.generatorNotParenthesized()]]],
    ['consume(first, [|/*error0*/*group for group in groups|])', [['error0', LocMessage.generatorNotParenthesized()]]],
    [
        'consume([|/*error0*/*group for group in groups|], key=value)',
        [['error0', LocMessage.generatorNotParenthesized()]],
    ],
    [
        'consume[|/*error1*/(|]key=[|/*error0*/*|]group for group in groups)',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseParen()],
        ],
    ],
    ['(*[|/*error0*/group if enabled else ()|],)', [['error0', LocMessage.unpackOperatorNotAllowed()]]],
    ['{**[|/*error0*/part if enabled else {}|]}', [['error0', LocMessage.unpackOperatorNotAllowed()]]],
    ['(*[|/*error0*/group or other|],)', [['error0', LocMessage.unpackOperatorNotAllowed()]]],
    ['(*[|/*error0*/not group|],)', [['error0', LocMessage.unpackOperatorNotAllowed()]]],
    ['(*[|/*error0*/group in others|],)', [['error0', LocMessage.unpackOperatorNotAllowed()]]],
    ['{**[|/*error0*/part or other|]}', [['error0', LocMessage.unpackOperatorNotAllowed()]]],
    ['{**[|/*error0*/part == other|]}', [['error0', LocMessage.unpackOperatorNotAllowed()]]],
    ['(*group [|/*error0*/:=|] other for group in groups)', [['error0', LocMessage.walrusNotAllowed()]]],
    ['consume(*group [|/*error0*/:=|] other for group in groups)', [['error0', LocMessage.walrusNotAllowed()]]],
    [
        '(*group if enabled else captured [|/*error0*/:=|] fallback for group in groups)',
        [['error0', LocMessage.walrusNotAllowed()]],
    ],
    [
        'consume(*group if enabled else captured [|/*error0*/:=|] fallback for group in groups)',
        [['error0', LocMessage.walrusNotAllowed()]],
    ],
    [
        '{**part if enabled else captured [|/*error0*/:=|] fallback for part in parts}',
        [['error0', LocMessage.walrusNotAllowed()]],
    ],
    [
        '[|/*open*/(|][|/*bad*/* **part|],)',
        [
            ['bad', LocMessage.dictUnpackInGenerator()],
            ['open', LocMessage.expectedCloseParen()],
        ],
    ],
])('Invalid comprehension unpacking recovers into the following statement: %s', verifyComprehensionUnpackingRecovery);

test.each<[string, [string, string][]]>([
    [
        '[|[/*error1*/|]*group for group in [|/*error0*/]|]',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseBracket()],
        ],
    ],
    [
        '[|{/*error1*/|]*group for group in [|/*error0*/}|]',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseBrace()],
        ],
    ],
    [
        '[|{/*error1*/|]**part for part in [|/*error0*/}|]',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseBrace()],
        ],
    ],
    [
        '[|/*error1*/(|]*group for group in [|/*error0*/)|]',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseParen()],
        ],
    ],
    [
        'consume[|/*error1*/(|]*group for group in [|/*error0*/)|]',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseParen()],
        ],
    ],
    [
        'consume[|/*error2*/(|][|/*error1*/(|]*group for group in [|/*error0*/)|])',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseParen()],
            ['error2', LocMessage.expectedCloseParen()],
        ],
    ],
    [
        'consume[|/*error2*/(|]*group [|/*error0*/for|] [|/*error1*/)|]',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedIn()],
            ['error2', LocMessage.expectedCloseParen()],
        ],
    ],
    [
        '[|[/*error1*/|]*group for group in groups if [|/*error0*/]|]',
        [
            ['error0', LocMessage.expectedExpr()],
            ['error1', LocMessage.expectedCloseBracket()],
        ],
    ],
])('Incomplete comprehension unpacking preserves later statements: %s', verifyComprehensionUnpackingRecovery);

function verifyComprehensionUnpackingRecovery(source: string, expected: [string, string][]) {
    const data = parseTestData('', `////${source}\n////after = 1\n`, 'main.py');
    const options = new ParseOptions();
    options.pythonVersion = pythonVersion3_15;
    const sink = new DiagnosticSink();
    const results = TestUtils.parseText(data.files[0].content, sink, options);
    assert.deepStrictEqual(
        sink.getErrors().map(({ message, range }) => ({ message, range })),
        expected.map(([name, message]) => {
            const range = getRangeByMarkerName(data, name);
            assert.ok(range);
            return {
                message,
                range: convertOffsetsToRange(range.pos, range.end, results.parserOutput.lines),
            };
        })
    );
    const statements = results.parserOutput.parseTree.d.statements;
    const lastStatement = statements[statements.length - 1];
    assert.ok(lastStatement?.nodeType === ParseNodeType.StatementList);
    const assignment = lastStatement.d.statements[0];
    assert.ok(assignment.nodeType === ParseNodeType.Assignment);
    assert.ok(assignment.d.leftExpr.nodeType === ParseNodeType.Name);
    assert.strictEqual(assignment.d.leftExpr.d.value, 'after');
}

test.each([
    '[item for group in groups for item in group]',
    '{key: value for key, value in items}',
    '(item for item in items)',
    'consume(item for item in items)',
    'consume(*groups)',
    'consume(*(item for item in items))',
    'consume(**mapping)',
    '[*groups]',
    '{*groups}',
    '{**mapping}',
    '(*groups,)',
    '(*groups, other)',
    'consume(*(first if enabled else second))',
    '{**(first if enabled else second)}',
    '(*(first or second),)',
    '(*(not first),)',
    '(*(first == second),)',
    '(*(lambda: first),)',
    '{**(first or second)}',
    '{**(first is second)}',
    '{**(lambda: first)}',
])('Ordinary unpacking and comprehension syntax is preserved: %s', (source) => {
    for (const version of [pythonVersion3_14, pythonVersion3_15]) {
        const options = new ParseOptions();
        options.pythonVersion = version;
        const sink = new DiagnosticSink();
        TestUtils.parseText(source, sink, options);
        assert.deepStrictEqual(sink.getErrors(), []);
    }
});

test.each(['dictionary', 'tuple'])('Nested ordinary %s unpacking is parsed once per operand', (kind) => {
    for (const version of [pythonVersion3_14, pythonVersion3_15]) {
        for (const depth of [1, 2, 4, 8]) {
            let expression = 'base';
            for (let index = 0; index < depth; index++) {
                expression = kind === 'dictionary' ? `{**${expression}}` : `(*${expression},)`;
            }
            const options = new ParseOptions();
            options.pythonVersion = version;
            const sink = new DiagnosticSink();
            const first = getNextNodeId();
            TestUtils.parseText(`value = ${expression}\n`, sink, options);
            const allocations = getNextNodeId() - first - 1;
            assert.deepStrictEqual(sink.getErrors(), []);
            assert.strictEqual(allocations, 5 + 2 * depth);
        }
    }
});

test('Parser uses a precomputed content fingerprint when provided', () => {
    const parser = new Parser();
    const fingerprint = getStringFingerprint('precomputed');
    const results = parser.parseSourceFile('', new ParseOptions(), new DiagnosticSink(), fingerprint);
    assert.deepEqual(results.contentHash, fingerprint);
});

test('Parser computes the complete content fingerprint for Unicode text when one is not provided', () => {
    const results = new Parser().parseSourceFile('π😀\n', new ParseOptions(), new DiagnosticSink());

    assert.deepEqual(results.contentHash, {
        primary: 83559239,
        secondary: -893512024,
    });
});

test('Parser1', () => {
    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseSampleFile('parser1.py', diagSink).parserOutput;

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parserOutput.parseTree.d.statements.length, 4);
});

test('Parser2', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('parser2.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 0);
});

test('FStringEmptyTuple', () => {
    assert.doesNotThrow(() => {
        const diagSink = new DiagnosticSink();
        TestUtils.parseSampleFile('fstring6.py', diagSink);
    });
});

test('SuiteExpectedColon1', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('suiteExpectedColon1.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 1);
});

test('SuiteExpectedColon2', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('suiteExpectedColon2.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 1);
});

test('SuiteExpectedColon3', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('suiteExpectedColon3.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 1);
});

test('ExpressionWrappedInParens', () => {
    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseText('(str)', diagSink).parserOutput;

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parserOutput.parseTree.d.statements.length, 1);
    assert.equal(parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.StatementList);

    const statementList = parserOutput.parseTree.d.statements[0] as StatementListNode;
    assert.equal(statementList.d.statements.length, 1);

    // length of node should include parens
    assert.equal(statementList.d.statements[0].nodeType, ParseNodeType.Name);
    assert.equal(statementList.d.statements[0].length, 5);
});

test('MaxParseDepth1', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('maxParseDepth1.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 1);
});

test('MaxParseDepth2', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('maxParseDepth2.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 4);
});

test('ModuleName range', () => {
    const code = `
//// from [|/*marker*/...|] import A
        `;

    const state = parseAndGetTestState(code).state;
    const expectedRange = state.getRangeByMarkerName('marker');
    const node = getNodeAtMarker(state);

    assert.strictEqual(node.start, expectedRange?.pos);
    assert.strictEqual(TextRange.getEnd(node), expectedRange?.end);
});

test('Inline TypedDict dict key is not a forward-reference annotation', () => {
    // An inline TypedDict field-name key must not be parsed into a
    // forward-reference expression even though the dictionary appears inside a type
    // annotation. Suspending type-annotation parsing for the key leaves its StringList
    // without a parser-derived annotation association, while the value remains a type
    // annotation and must still parse its forward reference.
    const code = `
//// from typing import TypedDict
//// td: TypedDict[{"/*key*/as_var": "/*value*/int"}]
        `;

    const state = parseAndGetTestState(code).state;

    const keyStringList = getFirstAncestorOrSelfOfKind(getNodeAtMarker(state, 'key'), ParseNodeType.StringList);
    assert.ok(keyStringList, 'Expected the dict key to be a StringList node');
    assert.strictEqual(
        getParserStringAnnotation(keyStringList),
        undefined,
        'Inline TypedDict key string must not be parsed into a forward-reference annotation'
    );

    const valueStringList = getFirstAncestorOrSelfOfKind(getNodeAtMarker(state, 'value'), ParseNodeType.StringList);
    assert.ok(valueStringList, 'Expected the dict value to be a StringList node');
    assert.ok(
        getParserStringAnnotation(valueStringList),
        'Inline TypedDict value string is a type annotation and must still parse its forward reference'
    );
});

test('Parser string-annotation side data preserves recursive associations and structural ownership', () => {
    const source = `value: "list['Data']"\n`;
    const parserOutput = TestUtils.parseText(source, new DiagnosticSink()).parserOutput;
    const outerNode = findNodeByOffset(parserOutput.parseTree, source.indexOf('list'));
    const outerStringList = getFirstAncestorOrSelfOfKind(outerNode, ParseNodeType.StringList);
    assert.ok(outerStringList);

    const outerAnnotation = parserOutput.stringAnnotations.get(outerStringList);
    assert.ok(outerAnnotation);
    const nestedNode = findNodeByOffset(outerAnnotation, source.indexOf('Data'));
    const nestedStringList = getFirstAncestorOrSelfOfKind(nestedNode, ParseNodeType.StringList);
    assert.ok(nestedStringList);

    const nestedAnnotation = parserOutput.stringAnnotations.get(nestedStringList);
    assert.ok(nestedAnnotation);
    assert.strictEqual(nestedAnnotation.nodeType, ParseNodeType.Name);
    if (nestedAnnotation.nodeType !== ParseNodeType.Name) {
        throw new Error('Expected the nested quoted annotation to parse as a name');
    }

    assert.strictEqual(nestedAnnotation.d.value, 'Data');
    assert.strictEqual(outerAnnotation.parent, outerStringList);
    assert.strictEqual(nestedAnnotation.parent, nestedStringList);
    assert.strictEqual(outerStringList.a, parserOutput.parseTree.a);
    assert.strictEqual(nestedStringList.a, parserOutput.parseTree.a);
    assert.strictEqual(parserOutput.stringAnnotations, getParserStringAnnotationInfo(parserOutput.parseTree));
    assert.deepStrictEqual(Object.keys(outerStringList.d), ['strings', 'hasParens']);
});

test('Parser string-annotation side data excludes unsupported and non-annotation strings', () => {
    const cases = [
        { source: `value = "Ordinary"\n`, needle: 'Ordinary', expected: false },
        { source: `value: "Esc\\x61ped"\n`, needle: 'Esc', expected: false },
        { source: `value: r"Raw"\n`, needle: 'Raw', expected: false },
        { source: `value: b"Bytes"\n`, needle: 'Bytes', expected: false },
        { source: `value: f"Formatted"\n`, needle: 'Formatted', expected: false },
        { source: `value: "Positive"\n`, needle: 'Positive', expected: true },
    ];

    for (const testCase of cases) {
        const parserOutput = TestUtils.parseText(testCase.source, new DiagnosticSink()).parserOutput;
        const node = findNodeByOffset(parserOutput.parseTree, testCase.source.indexOf(testCase.needle));
        const stringList = getFirstAncestorOrSelfOfKind(node, ParseNodeType.StringList);
        assert.ok(stringList, `Expected a StringList for ${testCase.source.trim()}`);
        assert.strictEqual(
            parserOutput.stringAnnotations.get(stringList) !== undefined,
            testCase.expected,
            testCase.source.trim()
        );
    }
});

test('ParserRecovery1', () => {
    const diagSink = new DiagnosticSink();
    const parseResults = TestUtils.parseSampleFile('parserRecovery1.py', diagSink);

    const node = findNodeByOffset(parseResults.parserOutput.parseTree, parseResults.text.length - 2);
    const functionNode = getFirstAncestorOrSelfOfKind(node, ParseNodeType.Function);
    assert.equal(functionNode!.parent!.nodeType, ParseNodeType.Module);
});

test('ParserRecovery2', () => {
    const diagSink = new DiagnosticSink();
    const parseResults = TestUtils.parseSampleFile('parserRecovery2.py', diagSink);

    const node = findNodeByOffset(parseResults.parserOutput.parseTree, parseResults.text.length - 2);
    const functionNode = getFirstAncestorOrSelfOfKind(node, ParseNodeType.Function);
    assert.equal(functionNode!.parent!.nodeType, ParseNodeType.Suite);
});

test('ParserRecovery3', () => {
    const diagSink = new DiagnosticSink();
    const parseResults = TestUtils.parseSampleFile('parserRecovery3.py', diagSink);

    const node = findNodeByOffset(parseResults.parserOutput.parseTree, parseResults.text.length - 2);
    const functionNode = getFirstAncestorOrSelfOfKind(node, ParseNodeType.Function);
    assert.equal(functionNode!.parent!.nodeType, ParseNodeType.Module);
});

test('FinallyExit1', () => {
    const execEnvironment = new ExecutionEnvironment(
        'python',
        UriEx.file('.'),
        getStandardDiagnosticRuleSet(),
        /* defaultPythonVersion */ undefined,
        /* defaultPythonPlatform */ undefined,
        /* defaultExtraPaths */ undefined
    );

    const diagSink1 = new DiagnosticSink();
    execEnvironment.pythonVersion = pythonVersion3_13;
    TestUtils.parseSampleFile('finallyExit1.py', diagSink1, execEnvironment);
    assert.strictEqual(diagSink1.getErrors().length, 0);

    const diagSink2 = new DiagnosticSink();
    execEnvironment.pythonVersion = pythonVersion3_14;
    TestUtils.parseSampleFile('finallyExit1.py', diagSink2, execEnvironment);
    assert.strictEqual(diagSink2.getErrors().length, 5);
});

test('TrailingBackslashCRAtEOF', () => {
    // A file that ends with a line-continuation backslash followed by a CR
    // should produce a syntax error.
    const code = '"""Comment"""\n\n\\\r';

    const diagSink = new DiagnosticSink();
    TestUtils.parseText(code, diagSink);
    const errors = diagSink.getErrors();
    assert.strictEqual(errors.length > 0, true);
    assert.ok(errors.some((e) => e.message.includes('Unexpected EOF')));
});

test('LazyImport - Python 3.15', () => {
    const diagSink = new DiagnosticSink();
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_15;

    const parserOutput = TestUtils.parseText(
        'lazy import json\nlazy from json import loads\nlazy = 1\n',
        diagSink,
        parseOptions
    ).parserOutput;

    // No syntax errors at 3.15.
    assert.strictEqual(diagSink.getErrors().length, 0);

    // First statement: lazy import json
    const stmt0 = parserOutput.parseTree.d.statements[0] as StatementListNode;
    const importNode = stmt0.d.statements[0];
    assert.strictEqual(importNode.nodeType, ParseNodeType.Import);
    if (importNode.nodeType === ParseNodeType.Import) {
        assert.strictEqual(importNode.d.isLazy, true);
        assert.ok(importNode.d.lazyToken);
    }

    // Second statement: lazy from json import loads
    const stmt1 = parserOutput.parseTree.d.statements[1] as StatementListNode;
    const importFromNode = stmt1.d.statements[0];
    assert.strictEqual(importFromNode.nodeType, ParseNodeType.ImportFrom);
    if (importFromNode.nodeType === ParseNodeType.ImportFrom) {
        assert.strictEqual(importFromNode.d.isLazy, true);
        assert.ok(importFromNode.d.lazyToken);
    }

    // Third statement: lazy = 1 (identifier use, not a keyword)
    const stmt2 = parserOutput.parseTree.d.statements[2] as StatementListNode;
    const assignNode = stmt2.d.statements[0];
    assert.strictEqual(assignNode.nodeType, ParseNodeType.Assignment);
});

test('LazyImport - Python 3.14 produces error', () => {
    const diagSink = new DiagnosticSink();
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_14;

    TestUtils.parseText('lazy import json\n', diagSink, parseOptions);

    const errors = diagSink.getErrors();
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].message === LocMessage.lazyImportIllegal());
});

test('LazyImport - from form version gate at 3.14', () => {
    const diagSink = new DiagnosticSink();
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_14;

    TestUtils.parseText('lazy from json import loads\n', diagSink, parseOptions);

    const errors = diagSink.getErrors();
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].message === LocMessage.lazyImportIllegal());
});

test('LazyImport - stub file at 3.14 does not error', () => {
    const diagSink = new DiagnosticSink();
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_14;
    parseOptions.isStubFile = true;

    TestUtils.parseText('lazy import json\nlazy from json import loads\n', diagSink, parseOptions);

    assert.strictEqual(diagSink.getErrors().length, 0);
});

test('LazyImport - lazy as module name at 3.15', () => {
    const diagSink = new DiagnosticSink();
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_15;

    const parserOutput = TestUtils.parseText('import lazy\nfrom lazy import x\n', diagSink, parseOptions).parserOutput;

    assert.strictEqual(diagSink.getErrors().length, 0);

    // 'import lazy' — regular import, not lazy
    const stmt0 = parserOutput.parseTree.d.statements[0] as StatementListNode;
    const importNode = stmt0.d.statements[0];
    assert.strictEqual(importNode.nodeType, ParseNodeType.Import);
    if (importNode.nodeType === ParseNodeType.Import) {
        assert.ok(!importNode.d.isLazy);
    }

    // 'from lazy import x' — regular import, not lazy
    const stmt1 = parserOutput.parseTree.d.statements[1] as StatementListNode;
    const importFromNode = stmt1.d.statements[0];
    assert.strictEqual(importFromNode.nodeType, ParseNodeType.ImportFrom);
    if (importFromNode.nodeType === ParseNodeType.ImportFrom) {
        assert.ok(!importFromNode.d.isLazy);
    }
});

test('LazyImport - soft-keyword identifier interactions at 3.15', () => {
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_15;

    const snippets = [
        'def lazy(): pass\n',
        'class lazy: pass\n',
        'f(lazy=1)\n',
        'def f(lazy=1): pass\n',
        'obj.lazy\n',
        '(lazy := 1)\n',
        'lambda lazy: lazy\n',
    ];

    for (const snippet of snippets) {
        const sink = new DiagnosticSink();
        TestUtils.parseText(snippet, sink, parseOptions);
        assert.strictEqual(sink.getErrors().length, 0, `Unexpected error for: ${snippet.trim()}`);
    }
});

test('LazyImport - payload variants at 3.15', () => {
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_15;

    const variants = [
        'lazy import a.b.c\n',
        'lazy import os as o\n',
        'lazy import os, sys\n',
        'lazy from .pkg import x\n',
        'lazy from ..pkg import x\n',
        'lazy from m import (a, b, c)\n',
    ];

    for (const variant of variants) {
        const sink = new DiagnosticSink();
        const parserOutput = TestUtils.parseText(variant, sink, parseOptions).parserOutput;
        assert.strictEqual(sink.getErrors().length, 0, `Unexpected error for: ${variant.trim()}`);

        const stmt0 = parserOutput.parseTree.d.statements[0] as StatementListNode;
        const node = stmt0.d.statements[0];
        if (node.nodeType === ParseNodeType.Import) {
            assert.strictEqual(node.d.isLazy, true, `Expected isLazy=true for: ${variant.trim()}`);
        } else if (node.nodeType === ParseNodeType.ImportFrom) {
            assert.strictEqual(node.d.isLazy, true, `Expected isLazy=true for: ${variant.trim()}`);
        } else {
            assert.fail(`Unexpected node type for: ${variant.trim()}`);
        }
    }
});

test('LazyImport - wildcard import rejected at 3.15', () => {
    const diagSink = new DiagnosticSink();
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_15;

    TestUtils.parseText('lazy from m import *\n', diagSink, parseOptions);

    const errors = diagSink.getErrors();
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].message === LocMessage.lazyImportWildcardIllegal());
});

test('LazyImport - scope restrictions', () => {
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_15;

    const invalidStatements = [
        ['function', 'def f():\n    lazy import json\n'],
        ['nested function', 'if True:\n    def f():\n        lazy import json\n'],
        ['class', 'class C:\n    lazy import json\n'],
        ['try', 'try:\n    lazy import json\nexcept ImportError:\n    pass\n'],
        ['nested try suite', 'try:\n    if True:\n        lazy import json\nfinally:\n    pass\n'],
        ['except', 'try:\n    pass\nexcept ImportError:\n    lazy import json\n'],
        ['except*', 'try:\n    pass\nexcept* Exception:\n    lazy import json\n'],
        ['else', 'try:\n    pass\nexcept ImportError:\n    pass\nelse:\n    lazy import json\n'],
        ['finally', 'try:\n    pass\nfinally:\n    lazy import json\n'],
    ] as const;

    for (const [scope, source] of invalidStatements) {
        const diagSink = new DiagnosticSink();
        TestUtils.parseText(source, diagSink, parseOptions);
        assert.deepStrictEqual(
            diagSink.getErrors().map((error) => error.message),
            ['Lazy imports are only allowed at module scope and outside try statements'],
            `Expected a scope diagnostic for lazy import in ${scope}`
        );
    }
});

test('LazyImport - future import is rejected', () => {
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_15;

    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseText(
        'lazy from __future__ import annotations\n',
        diagSink,
        parseOptions
    ).parserOutput;

    assert.deepStrictEqual(
        diagSink.getErrors().map((error) => error.message),
        ["Future imports cannot be used with 'lazy'"]
    );
    assert.deepStrictEqual([...parserOutput.futureImports], []);
});

test('LazyImport - valid module suites and recovery after restricted suites', () => {
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_15;

    const diagSink = new DiagnosticSink();
    TestUtils.parseText(
        'class C:\n' +
            '    lazy import json\n' +
            'try:\n' +
            '    lazy import sys\n' +
            'finally:\n' +
            '    pass\n' +
            'if True:\n' +
            '    lazy import os\n' +
            'with open(__file__):\n' +
            '    lazy from os import path\n' +
            'lazy import math\n',
        diagSink,
        parseOptions
    );

    assert.deepStrictEqual(
        diagSink.getErrors().map((error) => error.message),
        [
            'Lazy imports are only allowed at module scope and outside try statements',
            'Lazy imports are only allowed at module scope and outside try statements',
        ]
    );
});

test('LazyImport - incomplete from-import recovers for following statements', () => {
    const parseOptions = new ParseOptions();
    parseOptions.pythonVersion = pythonVersion3_15;

    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseText(
        'lazy from pkg import\nlazy import json\n',
        diagSink,
        parseOptions
    ).parserOutput;

    assert.ok(diagSink.getErrors().length > 0);

    const recoveredStatementList = parserOutput.parseTree.d.statements[1] as StatementListNode;
    const recoveredStatement = recoveredStatementList.d.statements[0];
    assert.strictEqual(recoveredStatement.nodeType, ParseNodeType.Import);
    if (recoveredStatement.nodeType === ParseNodeType.Import) {
        assert.strictEqual(recoveredStatement.d.isLazy, true);
    }
});

test('LazyImport - AliasDeclaration.isLazy is propagated', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "executionEnvironments": [
////     { "root": ".", "pythonVersion": "3.15" }
////   ]
//// }

// @filename: test.py
//// lazy import os
//// lazy from os import path as p
//// import sys
    `;

    const { state } = parseAndGetTestState(code);
    while (state.program.analyze()) {
        // Analyze until stable.
    }

    const testFileUri = state.activeFile.fileUri;
    const symbolTable = state.program.getModuleSymbolTable(testFileUri)!;
    assert.ok(symbolTable);

    // Check lazy import: os should have isLazy === true
    const osSymbol = symbolTable.get('os')!;
    assert.ok(osSymbol);
    const osDecls = osSymbol.getDeclarations();
    assert.ok(osDecls.length > 0);
    const osAliasDecl = osDecls.find((d) => d.type === DeclarationType.Alias) as AliasDeclaration | undefined;
    assert.ok(osAliasDecl);
    assert.strictEqual(osAliasDecl.isLazy, true);

    // Check lazy from-import: p should have isLazy === true
    const pSymbol = symbolTable.get('p')!;
    assert.ok(pSymbol);
    const pDecls = pSymbol.getDeclarations();
    assert.ok(pDecls.length > 0);
    const pAliasDecl = pDecls.find((d) => d.type === DeclarationType.Alias) as AliasDeclaration | undefined;
    assert.ok(pAliasDecl);
    assert.strictEqual(pAliasDecl.isLazy, true);

    // Check normal import: sys should NOT have isLazy
    const sysSymbol = symbolTable.get('sys')!;
    assert.ok(sysSymbol);
    const sysDecls = sysSymbol.getDeclarations();
    assert.ok(sysDecls.length > 0);
    const sysAliasDecl = sysDecls.find((d) => d.type === DeclarationType.Alias) as AliasDeclaration | undefined;
    assert.ok(sysAliasDecl);
    assert.ok(!sysAliasDecl.isLazy);
});

test('LazyImport - submoduleFallback AliasDeclaration carries isLazy', () => {
    // Exercises the implicit-submodule path in visitImportFrom: when
    // `lazy from <pkg> import <submodule>` resolves the imported name to an
    // implicit submodule, the submoduleFallback AliasDeclaration must carry
    // the isLazy flag too (otherwise downstream consumers reading
    // submoduleFallback.isLazy would silently lose the lazy bit).
    const code = `
// @filename: pyrightconfig.json
//// {
////   "executionEnvironments": [
////     { "root": ".", "pythonVersion": "3.15" }
////   ]
//// }

// @filename: test.py
//// lazy from mypkg import sub
//// from mypkg import sub as eagerSub
//// /*marker*/

// @filename: mypkg/__init__.py
//// # empty

// @filename: mypkg/sub.py
//// VALUE = 1
    `;

    const { state } = parseAndGetTestState(code);
    while (state.program.analyze()) {
        // Analyze until stable.
    }

    const testFileUri = state.activeFile.fileUri;
    const symbolTable = state.program.getModuleSymbolTable(testFileUri)!;
    assert.ok(symbolTable);

    const subSymbol = symbolTable.get('sub')!;
    assert.ok(subSymbol);
    const subDecls = subSymbol.getDeclarations();
    const subAliasDecl = subDecls.find((d) => d.type === DeclarationType.Alias) as AliasDeclaration | undefined;
    assert.ok(subAliasDecl);
    assert.strictEqual(subAliasDecl.isLazy, true);
    // submoduleFallback should also carry the lazy flag.
    assert.ok(subAliasDecl.submoduleFallback);
    assert.strictEqual(subAliasDecl.submoduleFallback.type, DeclarationType.Alias);
    assert.strictEqual((subAliasDecl.submoduleFallback as AliasDeclaration).isLazy, true);

    const eagerSubSymbol = symbolTable.get('eagerSub')!;
    assert.ok(eagerSubSymbol);
    const eagerSubDecls = eagerSubSymbol.getDeclarations();
    const eagerSubAliasDecl = eagerSubDecls.find((d) => d.type === DeclarationType.Alias) as
        | AliasDeclaration
        | undefined;
    assert.ok(eagerSubAliasDecl);
    assert.ok(!eagerSubAliasDecl.isLazy);
    assert.ok(eagerSubAliasDecl.submoduleFallback);
    assert.ok(!(eagerSubAliasDecl.submoduleFallback as AliasDeclaration).isLazy);
});
