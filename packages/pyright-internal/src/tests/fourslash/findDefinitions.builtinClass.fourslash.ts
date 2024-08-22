/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from operator import itemgetter
//// x = 4
//// itemgetter().[|/*marker*/__call__|](x)

// @filename: operator.py
// @library: true
//// class itemgetter:
////     def [|__call__|](self, obj):
////         pass
////

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker: {
                definitions: rangeMap
                    .get('__call__')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferSource'
    );
}
