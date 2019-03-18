/*
* parser.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Unit tests for Python parser.
*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { PostParseWalker } from '../analyzer/postParseWalker';
import { DiagnosticSink, TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { ModuleNode } from '../parser/parseNodes';
import { ParseOptions, Parser } from '../parser/parser';
import { TestWalker } from './testWalker';

function _parseText(text: string, diagSink: DiagnosticSink): ModuleNode {
    const parser = new Parser();
    let parseOptions = new ParseOptions();
    let parseResults = parser.parseSourceFile(text, parseOptions, diagSink);
    let textRangeDiagSink = new TextRangeDiagnosticSink(parseResults.lines,
        diagSink.diagnostics);

    // Link the parents.
    let parentWalker = new PostParseWalker(textRangeDiagSink,
        parseResults.parseTree, false);
    parentWalker.analyze();

    // Walk the AST to verify internal consistency.
    let testWalker = new TestWalker();
    testWalker.walk(parseResults.parseTree);

    return parseResults.parseTree;
}

function readTextFile(fileName: string): string {
    let filePath = path.resolve(path.dirname(module.filename), `./samples/${ fileName }`);

    try {
        return fs.readFileSync(filePath, { encoding: 'utf8' });
    } catch {
        console.error(`Could not read file "${ fileName }"`);
        return '';
    }
}

test('Empty', () => {
    let diagSink = new DiagnosticSink();
    let ast = _parseText('', diagSink);

    assert.equal(diagSink.diagnostics.length, 0);
    assert.equal(ast.statements.length, 0);
});

test('Sample1', () => {
    let fileText = readTextFile('sample1.py');
    let diagSink = new DiagnosticSink();
    let ast = _parseText(fileText, diagSink);

    assert.equal(diagSink.diagnostics.length, 0);
    assert.equal(ast.statements.length, 4);
});
