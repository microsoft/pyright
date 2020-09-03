/// <reference path="fourslash.ts" />

// @filename: test.py
//// class Model:
////     pass
////
//// def some_func1(a: Model):
////     x = a.unknownName.[|/*marker1*/|]
////     pass

// @ts-ignore
await helper.verifyCompletion('included', {
    marker1: {
        completions: [],
        moduleContext: { lastKnownModule: 'test', lastKnownMemberName: 'Model', unknownMemberName: 'unknownName' },
    },
});
