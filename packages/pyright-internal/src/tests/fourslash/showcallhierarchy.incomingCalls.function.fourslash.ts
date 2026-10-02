/// <reference path="typings/fourslash.d.ts" />

// @filename: declare.py
//// def /*marker1*/func():
////    return 1

// @filename: consume.py
//// from declare import func
//// from declare import /*marker2*/func as foobar
////
//// [|def [|/*callByNameSelection*/callByName|]():
////    /*marker3*/func()/*callByNameRange*/|]
//// def callByAlias():
////    foobar()

// @filename: consume2.py
//// from declare import func
////
//// [|/*callByName2Range*/def [|/*callByName2Selection*/callByName2|]():
////    func()|]

{
    const itemList = [
        {
            filePath: helper.getMappedFilePath('consume.py'),
            range: helper.getPositionRange('callByNameRange'),
            selectionRange: helper.getPositionRange('callByNameSelection'),
            name: 'callByName',
        },
        {
            filePath: helper.getMappedFilePath('consume2.py'),
            range: helper.getPositionRange('callByName2Range'),
            selectionRange: helper.getPositionRange('callByName2Selection'),
            name: 'callByName2',
        },
    ];

    helper.verifyShowCallHierarchyGetIncomingCalls({
        marker1: {
            items: itemList,
        },
        marker2: {
            items: itemList,
        },
        marker3: {
            items: itemList,
        },
    });
}
