/// <reference path="typings/fourslash.d.ts" />

// @filename: module1.py
//// def module1Func():
////     pass

// @filename: nest/__init__.py
//// # empty

// @filename: nest/module1.py
//// def nestModule1Func():
////     pass

// @filename: test1.py
//// from [|/*marker1*/nest|] import [|/*marker2*/module1|]
////
//// from [|/*marker3*/nest|].[|/*marker4*/module1|] import module1Func
////
//// import [|/*marker5*/nest|].[|/*marker6*/module1|]
//// import [|/*marker7*/module1|]
////
//// [|/*marker8*/nest|].[|/*marker9*/module1|]

{
    const nestReferences = helper
        .getRangesByText()
        .get('nest')!
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    const marker7 = helper.getMarkerByName('marker7');
    const module1References = helper
        .getRangesByText()
        .get('module1')!
        .filter((r) => r.marker !== marker7)
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    helper.verifyFindAllReferences({
        marker1: { references: nestReferences },
        marker2: { references: module1References },
        marker3: { references: nestReferences },
        marker4: { references: module1References },
        marker5: { references: nestReferences },
        marker6: { references: module1References },
        marker7: {
            references: helper
                .getRanges()
                .filter((r) => r.marker === marker7)
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
        marker8: { references: nestReferences },
        marker9: { references: module1References },
    });
}
