/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Model:
////     pass
////
//// def some_func1(a: Model):
////     x = a.unknownName.[|/*marker1*/|]
////     pass

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [],
        memberAccessInfo: { lastKnownModule: 'test', lastKnownMemberName: 'Model', unknownMemberName: 'unknownName' },
    },
});
