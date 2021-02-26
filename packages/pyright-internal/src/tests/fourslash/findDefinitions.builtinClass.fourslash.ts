/// <reference path="fourslash.ts" />

// @filename: test.py
//// from typing import [|/*marker*/Union|]

// @filename: typing.py
// @library: true
//// class _Union:
////     pass
////
//// [|Union|] = _Union()

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker: {
                definitions: rangeMap
                    .get('Union')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferSource'
    );
}
