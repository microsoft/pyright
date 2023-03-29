/// <reference path="fourslash.ts" />

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

    helper.verifyShowCallHierarchyGetIncomingCalls({
        marker1: {
            references: ranges.map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            }),
        },
        marker2: {
            references: ranges.map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            }),
        },
    });
}
