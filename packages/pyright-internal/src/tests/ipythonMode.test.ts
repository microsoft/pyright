/*
 * ipythonMode.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for tokenizer ipython mode
 */

import assert from 'assert';
import { CompletionItemKind, MarkupKind } from 'vscode-languageserver-types';

import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Localizer } from '../localization/localize';
import { Comment, CommentType, Token } from '../parser/tokenizerTypes';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('regular mode', () => {
    const code = `
//// [|/*marker*/%cd test|]
    `;

    testIPython(code, /*expectMagic*/ false);
});

test('ipython magic', () => {
    const code = `
// @ipythonMode: true
//// [|/*marker*/%cd test|]
    `;

    testIPython(code);
});

test('ipython shell escape', () => {
    const code = `
// @ipythonMode: true
//// [|/*marker*/!shellCommand|]
    `;

    testIPython(code);
});

test('ipython regular operator - mod', () => {
    const code = `
// @ipythonMode: true
//// a = 1 [|/*marker*/% 1|]
    `;

    testIPython(code, /*expectMagic*/ false);
});

test('ipython regular operator - bang', () => {
    const code = `
// @ipythonMode: true
//// a = 1
//// a [|/*marker*/!= 1|]
    `;

    testIPython(code, /*expectMagic*/ false);
});

test('ipython regular operator multiline', () => {
    const code = `
// @ipythonMode: true
//// a = 1 \\
//// [|/*marker*/% 1|]
    `;

    testIPython(code, /*expectMagic*/ false);
});

test('ipython at the top', () => {
    const code = `
// @ipythonMode: true
//// [|/*marker*/%cd test|]
//// b = 1
    `;

    testIPython(code);
});

test('ipython between statements', () => {
    const code = `
// @ipythonMode: true
//// a = 1
//// [|/*marker*/%cd test|]
//// b = 1
    `;

    testIPython(code);
});

test('ipython at the end', () => {
    const code = `
// @ipythonMode: true
//// a = 1
//// [|/*marker*/%cd test|]
    `;

    testIPython(code);
});

test('ipython multiline magics', () => {
    const code = `
// @ipythonMode: true
//// a = 1
//// [|/*marker*/%cd test \
////                 other arguments|]
    `;

    testIPython(code);
});

test('ipython cell mode magics', () => {
    const code = `
// @ipythonMode: true
//// [|/*marker*/%%timeit|]
    `;

    testIPython(code);
});

test('ipython with indentation', () => {
    const code = `
// @ipythonMode: true
//// def foo():
////     [|/*marker*/%cd test|]
////     pass
    `;

    testIPython(code);
});

test('ipython without indentation', () => {
    const code = `
// @ipythonMode: true
//// def foo():
//// [|/*marker*/%cd test|]
////     pass
    `;

    testIPython(code);
});

test('ipython mixed with regular comments 1', () => {
    const code = `
// @ipythonMode: true
//// def foo():
////     # comments
////     [|/*marker*/%cd test|]
////     pass
    `;

    testIPython(code);
});

test('ipython mixed with regular comments 2', () => {
    const code = `
// @ipythonMode: true
//// def foo():
////     # comments
////     [|/*marker*/%cd test|]
////     # comments
////     pass
    `;

    testIPython(code);
});

test('ipython mixed with regular comments 3', () => {
    const code = `
// @ipythonMode: true
//// def foo():
////     [|/*marker*/%cd test|]
////     # comments
////     pass
    `;

    testIPython(code);
});

test('ipython mixed with regular comments 4', () => {
    const code = `
// @ipythonMode: true
//// def foo():
//// [|/*marker*/%cd test|]
////     # comments
////     pass
    `;

    testIPython(code);
});

test('ipython multiple magics 1', () => {
    const code = `
// @ipythonMode: true
//// def foo():
//// [|/*marker*/%cd test|]
////     %cd test2
////     pass
    `;

    testIPython(code);
});

test('ipython multiple magics 2', () => {
    const code = `
// @ipythonMode: true
//// def foo():
//// %cd test
////     [|/*marker*/%cd test2|]
////     pass
    `;

    testIPython(code);
});

test('top level await raises errors in regular mode', () => {
    const code = `
//// async def foo():
////     pass
//// 
//// [|/*marker*/await foo();|]
    `;

    const state = parseAndGetTestState(code).state;
    const range = state.getRangeByMarkerName('marker')!;

    const source = state.program.getBoundSourceFile(range.fileName)!;
    const diagnostics = source.getDiagnostics(state.configOptions);

    assert(diagnostics?.some((d) => d.message === Localizer.Diagnostic.awaitNotInAsync()));
});

test('top level await raises no errors in ipython mode', () => {
    const code = `
// @ipythonMode: true
//// async def foo():
////     pass
//// 
//// [|/*marker*/await foo();|]
    `;

    const state = parseAndGetTestState(code).state;
    const range = state.getRangeByMarkerName('marker')!;

    const source = state.program.getBoundSourceFile(range.fileName)!;
    const diagnostics = source.getDiagnostics(state.configOptions);

    assert(!diagnostics?.some((d) => d.message === Localizer.Diagnostic.awaitNotInAsync()));
});

test('await still raises errors when used in wrong context in ipython mode', () => {
    const code = `
// @ipythonMode: true
//// async def foo():
////     pass
//// 
//// def bar():
////     [|/*marker*/await foo();|]
    `;

    const state = parseAndGetTestState(code).state;
    const range = state.getRangeByMarkerName('marker')!;

    const source = state.program.getBoundSourceFile(range.fileName)!;
    const diagnostics = source.getDiagnostics(state.configOptions);

    assert(diagnostics?.some((d) => d.message === Localizer.Diagnostic.awaitNotInAsync()));
});

test('try implicitly load ipython display module but fail', async () => {
    const code = `
// @ipythonMode: true
//// [|display/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('excluded', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    label: 'display',
                    kind: CompletionItemKind.Function,
                },
            ],
        },
    });
});

test('implicitly load ipython display module', async () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
// @ipythonMode: true
//// [|display/*marker*/|]

// @filename: IPython/__init__.py
// @library: true
//// 

// @filename: IPython/display.py
// @library: true
//// def display(): pass
    `;

    const state = parseAndGetTestState(code).state;

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        marker: {
            completions: [
                {
                    label: 'display',
                    kind: CompletionItemKind.Function,
                },
            ],
        },
    });
});

function testIPython(code: string, expectMagic = true) {
    const state = parseAndGetTestState(code).state;
    const range = state.getRangeByMarkerName('marker')!;

    const results = state.program.getBoundSourceFile(range.fileName)!.getParseResults()!;

    const comment = findCommentByOffset(results.tokenizerOutput.tokens, range.pos + 1);
    if (!expectMagic) {
        assert(!comment);
        return;
    }

    assert(comment);
    const text = results.text.substring(range.pos, range.end);

    const type = text[0] === '%' ? CommentType.IPythonMagic : CommentType.IPythonShellEscape;
    assert.strictEqual(type, comment.type);
    assert.strictEqual(text.substring(1), comment.value);
}

function findCommentByOffset(tokens: TextRangeCollection<Token>, offset: number) {
    let startIndex = tokens.getItemAtPosition(offset);
    startIndex = startIndex >= 0 ? startIndex : 0;

    let comment: Comment | undefined;
    for (let i = startIndex; i < tokens.count; i++) {
        const token = tokens.getItemAt(i);
        comment = token.comments?.find((c) => TextRange.contains(c, offset));
        if (comment) {
            break;
        }

        if (offset < token.start) {
            return undefined;
        }
    }

    return comment;
}
