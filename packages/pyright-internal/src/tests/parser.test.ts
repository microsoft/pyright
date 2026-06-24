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
import { pythonVersion3_13, pythonVersion3_14, pythonVersion3_15 } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { UriEx } from '../common/uri/uriUtils';
import { LocMessage } from '../localization/localize';
import { ParseNodeType, StatementListNode } from '../parser/parseNodes';
import { ParseOptions } from '../parser/parser';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';
import * as TestUtils from './testUtils';

test('Empty', () => {
    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseText('', diagSink).parserOutput;

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parserOutput.parseTree.d.statements.length, 0);
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
    // without a synthesized `annotation` expression, while the value remains a type
    // annotation and must still parse its forward reference.
    const code = `
//// from typing import TypedDict
//// td: TypedDict[{"/*key*/as_var": "/*value*/int"}]
        `;

    const state = parseAndGetTestState(code).state;

    const keyStringList = getFirstAncestorOrSelfOfKind(getNodeAtMarker(state, 'key'), ParseNodeType.StringList);
    assert.ok(keyStringList, 'Expected the dict key to be a StringList node');
    assert.strictEqual(
        keyStringList.d.annotation,
        undefined,
        'Inline TypedDict key string must not be parsed into a forward-reference annotation'
    );

    const valueStringList = getFirstAncestorOrSelfOfKind(getNodeAtMarker(state, 'value'), ParseNodeType.StringList);
    assert.ok(valueStringList, 'Expected the dict value to be a StringList node');
    assert.ok(
        valueStringList.d.annotation,
        'Inline TypedDict value string is a type annotation and must still parse its forward reference'
    );
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

    TestUtils.parseText('lazy import json\n', diagSink, parseOptions);

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
