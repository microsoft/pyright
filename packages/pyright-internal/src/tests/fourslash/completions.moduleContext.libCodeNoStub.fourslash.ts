/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import testnumpy
//// obj = testnumpy.random.randint("foo").[|/*marker1*/|]

// @filename: testnumpy/__init__.py
// @library: true
//// from . import random

// @filename: testnumpy/random/__init__.py
// @library: true
//// __all__ = ['randint']

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [],
        memberAccessInfo: {
            lastKnownModule: 'testnumpy.random',
            lastKnownMemberName: 'random',
            unknownMemberName: 'randint',
        },
    },
});
