/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Union
////
//// class [|C1|]:
////     pass
////
//// class N:
////     class [|C2|]:
////         pass
////
//// def foo([|/*marker1*/a|]: Union[C1, N.C2]):
////     pass

{
    helper.verifyFindTypeDefinitions({
        marker1: {
            definitions: helper
                .getFilteredRanges<{ target?: string }>((m, d, t) => t === 'C1' || t === 'C2')
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
    });
}
