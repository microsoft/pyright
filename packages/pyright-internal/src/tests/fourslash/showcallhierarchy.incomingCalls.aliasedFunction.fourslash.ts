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
//// [|def [|/*callByAliasSelection*/callByAlias|]():
////    /*marker2*/foobar()/*callByAliasRange*/|]

// @filename: consume2.py
//// from declare import func as foobar
////
//// def callByAlias2():
////    func()

{
    const itemList = [
        {
            filePath: helper.getMappedFilePath('consume.py'),
            range: helper.getPositionRange('callByAliasRange'),
            selectionRange: helper.getPositionRange('callByAliasSelection'),
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
