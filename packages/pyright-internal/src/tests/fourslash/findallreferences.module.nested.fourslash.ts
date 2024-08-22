/// <reference path="typings/fourslash.d.ts" />

// @filename: nested/__init__.py
//// from .[|/*module1*/module1|] import module1Func as module1Func

// @filename: nested/module1.py
//// def module1Func():
////     pass

// @filename: test1.py
//// import [|/*nest1*/nested|].[|/*module2*/module1|]
//// import [|/*nest2*/nested|].[|/*module3*/module1|] as m
////
//// [|/*nest3*/nested|].[|/*module4*/module1|].module1Func()

// @filename: test2.py
//// from [|/*nest4*/nested|].[|/*module5*/module1|] import module1Func
//// from .[|/*nest5*/nested|].[|/*module6*/module1|] import module1Func as f

// @filename: test3.py
//// from .[|/*nest6*/nested|] import [|/*module7*/module1|]
//// from .[|/*nest7*/nested|] import [|/*module8*/module1|] as m

// @filename: code/test4.py
//// from ..[|/*nest8*/nested|] import [|/*module9*/module1|]
//// from ..[|/*nest9*/nested|] import [|/*module10*/module1|] as m
//// from ..[|/*nest10*/nested|].[|/*module11*/module1|] import module1Func

{
    const nestedReferences = helper
        .getRangesByText()
        .get('nested')!
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    const moduleReferences = helper
        .getRangesByText()
        .get('module1')!
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    helper.verifyFindAllReferences({
        nest1: { references: nestedReferences },
        nest2: { references: nestedReferences },
        nest3: { references: nestedReferences },
        nest4: { references: nestedReferences },
        nest5: { references: nestedReferences },
        nest6: { references: nestedReferences },
        nest7: { references: nestedReferences },
        nest8: { references: nestedReferences },
        nest9: { references: nestedReferences },
        nest10: { references: nestedReferences },
        module1: { references: moduleReferences },
        module2: { references: moduleReferences },
        module3: { references: moduleReferences },
        module4: { references: moduleReferences },
        module5: { references: moduleReferences },
        module6: { references: moduleReferences },
        module7: { references: moduleReferences },
        module8: { references: moduleReferences },
        module9: { references: moduleReferences },
        module10: { references: moduleReferences },
        module11: { references: moduleReferences },
    });
}
