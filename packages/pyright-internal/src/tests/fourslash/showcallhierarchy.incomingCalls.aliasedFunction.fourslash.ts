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
//// def [|callByAlias|]():
////    /*marker2*/foobar()

// @filename: consume2.py
//// from declare import func as foobar
////
//// def callByAlias2():
////    func()

{
    const ranges = helper.getRanges();
    const itemList = ranges.map((range) => {
        return { filePath: range.fileName, range: helper.convertPositionRange(range), name: 'callByAlias' };
    });

    helper.verifyShowCallHierarchyGetIncomingCalls({
        marker1: {
            items: itemList,
        },
        marker2: {
            items: itemList,
        },
    });
}
