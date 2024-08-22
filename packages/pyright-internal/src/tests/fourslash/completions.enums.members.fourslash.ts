/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from enum import Enum
//// class Color(Enum):
////     RED = 1
////     GREEN = 2
////     BLUE = 3
////
////     NotAMember: int = 3
////
////     @property
////     def a_prop(self):
////         pass
////
//// Color./*marker*/

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: 'BLUE',
                kind: Consts.CompletionItemKind.EnumMember,
            },
            {
                label: 'GREEN',
                kind: Consts.CompletionItemKind.EnumMember,
            },
            {
                label: 'RED',
                kind: Consts.CompletionItemKind.EnumMember,
            },
            {
                label: 'a_prop',
                kind: Consts.CompletionItemKind.Property,
            },
            {
                label: 'NotAMember',
                kind: Consts.CompletionItemKind.Variable,
            },
        ],
    },
});
