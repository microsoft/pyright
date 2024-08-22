/// <reference path="typings/fourslash.d.ts" />

// @filename: declare.py
//// def func():
////     func2()
////     return func3()
////
//// def [|func2|]():
////     print(1)
////
//// def [|func3|]():
////     return 1

// @filename: consume.py
////
//// from declare import func as /*marker1*/foobar
////
//// def callByAlias():
////     /*marker2*/foobar()

// @filename: consume2.py
//// from declare import func as foobar
//// from declare import func
////
//// def callByBoth1():
////     func()
////     /*marker3*/foobar()
////
//// def callByBoth2():
////     /*marker4*/foobar()
////     func()

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
        marker4: {
            items: itemList,
        },
    });
}
