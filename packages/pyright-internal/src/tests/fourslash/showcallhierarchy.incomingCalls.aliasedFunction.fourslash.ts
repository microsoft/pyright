/// <reference path="typings/fourslash.d.ts" />

// @filename: declare.py
//// def func():
////    return 1

// @filename: consume.py
//// from declare import func
//// from declare import func as /*marker1*/foobar
////
//// def callByName():
////    func()
//// def [|/*callByAliasRange*/callByAlias|](): /*marker2*/foobar()

// @filename: consume2.py
//// from declare import func as foobar
////
//// def callByAlias2():
////    func()

{
    const callByAliasRange = helper.getPositionRange('callByAliasRange');
    const itemList = [
        {
            filePath: helper.getMappedFilePath('consume.py'),
            range: helper.expandPositionRange(callByAliasRange, 4, 12),
            selectionRange: callByAliasRange,
            name: 'callByAlias',
        },
    ];

    helper.verifyShowCallHierarchyGetIncomingCalls({
        marker1: {
            items: itemList,
        },
        marker2: {
            items: itemList,
        },
    });
}
