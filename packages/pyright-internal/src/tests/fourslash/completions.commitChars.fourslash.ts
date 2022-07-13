/// <reference path="fourslash.ts" />

// @filename: test.py
//// from samples import *
//// foo[|/*marker1*/|]
//// fooClass().foo[|/*marker2*/|]

// @filename: samples.py
//// import fooLib as fooLib
//// def fooFunc(): ...
//// class fooClass():
////     def fooMethod(self): ...

// @filename: fooLib.py
//// # empty

{
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: 'fooLib',
                    kind: Consts.CompletionItemKind.Module,
                    commitCharacters: ['.'],
                },
                {
                    label: 'fooFunc',
                    kind: Consts.CompletionItemKind.Function,
                    commitCharacters: ['('],
                },
                {
                    label: 'fooClass',
                    kind: Consts.CompletionItemKind.Class,
                    commitCharacters: ['.', '('],
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: 'fooMethod',
                    kind: Consts.CompletionItemKind.Method,
                    commitCharacters: ['('],
                },
            ],
        },
    });
}
