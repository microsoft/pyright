/// <reference path="typings/fourslash.d.ts" />

// @filename: declare.py
//// def /*marker1*/func():
////     func2()
////     return func3()
////
//// def [|func2|]():
////     print(1)
////
//// def [|func3|]():
////     return 1

// @filename: consume.py
//// from declare import /*marker2*/func
////
//// def callByName():
////    /*marker3*/func()

{
    const ranges = helper.getRanges();
    const references = ranges.map((range) => {
        return { path: range.fileName, range: helper.convertPositionRange(range) };
    });
    const itemList = [
        { filePath: references[0].path, range: references[0].range, name: 'func2' },
        { filePath: references[1].path, range: references[1].range, name: 'func3' },
    ];

    helper.verifyShowCallHierarchyGetOutgoingCalls({
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
