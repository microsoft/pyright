/// <reference path="typings/fourslash.d.ts" />

// @filename: module1.py
//// def module1Func():
////     pass

// @filename: nest1/__init__.py
//// # empty

// @filename: nest1/module1.py
//// def nest1Module1Func():
////     pass

// @filename: nest1/nest2/__init__.py
//// # empty

// @filename: nest1/nest2/module1.py
//// def nest2Module1Func():
////     pass

// @filename: test1.py
//// from [|/*nest1_1*/nest1|] import [|{| "name":"nest1_module1", "target":"nest1" |}module1|]
//// from [|/*nest1_2*/nest1|].[|/*nest2_1*/nest2|] import [|{| "name":"nest2_module1", "target":"nest2" |}module1|]
////
//// import [|/*nest1_3*/nest1|]
//// import [|/*nest1_4*/nest1|].[|/*nest2_2*/nest2|]
//// import [|/*nest1_5*/nest1|].[|/*nest2_3*/nest2|].[|{| "name":"nest2_module2", "target":"nest2" |}module1|]
////
//// from [|/*nest1_6*/nest1|] import [|/*nest2_4*/nest2|]
////
//// [|{| "name":"module4" |}module1|]
//// [|/*nest1_7*/nest1|]
//// [|/*nest1_8*/nest1|].[|/*nest2_5*/nest2|]
//// [|/*nest1_9*/nest1|].[|{| "name":"module5", "target":"none" |}module1|]

{
    const nest1References = helper
        .getRangesByText()
        .get('nest1')!
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    const nest2References = helper
        .getRangesByText()
        .get('nest2')!
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    const nest2ModuleReferences = helper
        .getFilteredRanges<{ target?: string }>(
            (m, d, t) => t === 'module1' && !!d && (!d.target || d.target === 'nest2')
        )
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    helper.verifyFindAllReferences({
        nest1_1: { references: nest1References },
        nest1_2: { references: nest1References },
        nest1_3: { references: nest1References },
        nest1_4: { references: nest1References },
        nest1_5: { references: nest1References },
        nest1_6: { references: nest1References },
        nest1_8: { references: nest1References },
        nest1_9: { references: nest1References },
        nest2_1: { references: nest2References },
        nest2_2: { references: nest2References },
        nest2_3: { references: nest2References },
        nest2_4: { references: nest2References },
        nest2_5: { references: nest2References },
        nest2_module1: { references: nest2ModuleReferences },
        nest2_module2: { references: nest2ModuleReferences },
        nest1_module1: {
            references: helper
                .getFilteredRanges<{ target?: string }>(
                    (m, d, t) => t === 'module1' && !!d && (!d.target || d.target === 'nest1')
                )
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
        module4: {
            references: helper
                .getFilteredRanges<{ target?: string }>((m, d, t) => t === 'module1' && !!d && d.target !== 'none')
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
        module5: {
            references: [],
        },
    });
}
