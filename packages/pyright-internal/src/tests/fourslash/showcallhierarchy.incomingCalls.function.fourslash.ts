/// <reference path="typings/fourslash.d.ts" />

// @filename: declare.py
//// /*marker3*/def /*marker1*/func():
////    return 1

// @filename: consume.py
//// from declare import func
////
//// def [|/*callByNameSelection*/callByName|](): /*marker2*/func()

// @filename: consume2.py
//// from declare import func
////
//// def [|/*callByName2Selection*/callByName2|](): func()

{
    const callByNameSelectionRange = helper.getPositionRange('callByNameSelection');
    const callByName2SelectionRange = helper.getPositionRange('callByName2Selection');
    const itemList = [
        {
            filePath: helper.getMappedFilePath('consume.py'),
            range: helper.expandPositionRange(callByNameSelectionRange, 4, 10),
            selectionRange: callByNameSelectionRange,
            name: 'callByName',
        },
        {
            filePath: helper.getMappedFilePath('consume2.py'),
            range: helper.expandPositionRange(callByName2SelectionRange, 4, 10),
            selectionRange: callByName2SelectionRange,
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
