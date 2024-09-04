/// <reference path="typings/fourslash.d.ts" />

// @filename: declare.py
//// def [|func|]():
////     func2()
////
//// def func2():
////     print(1)

// @filename: consume.py
//// from declare import func as [|foobar|]
//// from declare import func
////
//// def /*marker1*/callByAlias():
////     foobar()
////
//// def /*marker2*/callByName():
////     func()
////
//// def /*marker3*/callByBoth1():
////     func()
////     foobar()
////
//// def /*marker4*/callByBoth2():
////     foobar()
////     func()
{
    const ranges = helper.getRanges();
    const references = ranges.map((range) => {
        return { path: range.fileName, range: helper.convertPositionRange(range) };
    });

    helper.verifyShowCallHierarchyGetOutgoingCalls({
        marker1: {
            items: [{ filePath: references[0].path, range: references[0].range, name: 'foobar' }],
        },
        marker2: {
            items: [{ filePath: references[0].path, range: references[0].range, name: 'func' }],
        },
        marker3: {
            items: [{ filePath: references[0].path, range: references[0].range, name: 'func' }],
        },
        marker4: {
            items: [{ filePath: references[0].path, range: references[0].range, name: 'func' }],
        },
    });
}
