/// <reference path="fourslash.ts" />

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
        marker3: {
            references: ranges.map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            }),
        },
    });
}
