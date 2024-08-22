/// <reference path="typings/fourslash.d.ts" />

// @filename: module1.py
//// def module1Func():
////     pass

// @filename: test1.py
//// import [|/*marker1*/module1|]
//// import [|/*marker2*/module1|] as m
////
//// [|/*marker3*/module1|].module1Func()

// @filename: test2.py
//// from [|/*marker4*/module1|] import module1Func
//// from .[|/*marker5*/module1|] import module1Func as f

// @filename: test3.py
//// from . import [|/*marker6*/module1|]
//// from . import [|/*marker7*/module1|] as m

// @filename: nested/test4.py
//// from .. import [|/*marker8*/module1|]
//// from .. import [|/*marker9*/module1|] as m
//// from ..[|/*marker10*/module1|] import module1Func

{
    const references = helper
        .getRangesByText()
        .get('module1')!
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    helper.verifyFindAllReferences({
        marker1: { references },
        marker2: { references },
        marker3: { references },
        marker4: { references },
        marker5: { references },
        marker6: { references },
        marker7: { references },
        marker8: { references },
        marker9: { references },
        marker10: { references },
    });
}
