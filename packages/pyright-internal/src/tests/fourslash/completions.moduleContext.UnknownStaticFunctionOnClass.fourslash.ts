/// <reference path="fourslash.ts" />

// @filename: test.py
//// class Model:
////     @staticmethod
////     def foo( value ):
////         return value
////
////
//// x = Model.foo(unknownValue).[|/*marker1*/|]
////     pass
////
//// y = Model.unknownMember.[|/*marker2*/|]
////     pass
////
//// def some_func1(a: Model):
////     x = a.unknownMember.[|/*marker3*/|]
////     pass
////
//// Model.unknownValue.[|/*marker4*/|]
////
//// UnkownModel.unknownValue.[|/*marker5*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    // tests: _getLastKnownModule():  if (curNode.nodeType === ParseNodeType.MemberAccess && curNode.memberName)
    marker1: {
        completions: [],
        moduleContext: { lastKnownModule: 'test', lastKnownMemberName: 'foo', unknownMemberName: 'foo' },
    },
    // tests: _getLastKnownModule():  else if (curNode.nodeType === ParseNodeType.Name && isClass(curType))
    marker2: {
        completions: [],
        moduleContext: {
            lastKnownModule: 'test',
            lastKnownMemberName: 'Model',
            unknownMemberName: 'unknownMember',
        },
    },
    // tests: _getLastKnownModule(): else if (curNode.nodeType === ParseNodeType.Name && isObject(curType))
    marker3: {
        completions: [],
        moduleContext: {
            lastKnownModule: 'test',
            lastKnownMemberName: 'Model',
            unknownMemberName: 'unknownMember',
        },
    },
    marker4: {
        completions: [],
        moduleContext: { lastKnownModule: 'test', lastKnownMemberName: 'Model', unknownMemberName: 'unknownValue' },
    },
    marker5: {
        completions: [],
        moduleContext: {},
    },
});
