/// <reference path="fourslash.ts" />

// @filename: declare.py
//// my_variable = "Hello, world!"

// @filename: consume.py
//// from my_module import my_variable as /*marker*/greeting
////
//// print(greeting)

{
    const ranges = helper.getRanges();

    helper.verifyShowCallHierarchyGetIncomingCalls({
        marker: {
            references: ranges.map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            }),
        },
    });
}
