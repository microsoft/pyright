/// <reference path="typings/fourslash.d.ts" />

// @filename: declare.py
//// def /*marker1*/func():
////    return 1

// @filename: consume.py
//// from declare import func
//// from declare import /*marker2*/func as foobar
////
//// def [|callByName|]():
////    /*marker3*/func()
//// def callByAlias():
////    foobar()

// @filename: consume2.py
//// from declare import func
////
//// def [|callByName2|]():
////    func()

{
    const ranges = helper.getRanges();
    const references = ranges.map((range) => {
        return { path: range.fileName, range: helper.convertPositionRange(range) };
    });
    const itemList = [
        { filePath: references[0].path, range: references[0].range, name: 'callByName' },
        { filePath: references[1].path, range: references[1].range, name: 'callByName2' },
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
