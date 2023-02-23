/// <reference path="fourslash.ts" />
// @filename: pyrightconfig.json
//// {
////   "exclude": [ "foo/**" ],
////   "extraPaths": [ "build" ],
////   "useLibraryCodeForTypes": true
//// }

// @filename: build/foo/__init__.py
//// # Package def
// @filename: build/foo/a.py
//// def [|method_bar|](): ...
// @filename: foo/__init__.py
//// # Package def
// @filename: foo/a.py
//// def [|method_bar|](): ...
// @filename: foo/b.py
//// import foo.a
//// foo.a.[|me/*marker1*/thod_bar|]()
// @filename: test/test_a.py
//// import foo.a
//// foo.a.[|me/*marker2*/thod_bar|]()

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: rangeMap
                    .get('method_bar')!
                    .filter((r) => !r.marker && !r.fileName.includes('build'))
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker2: {
                definitions: rangeMap
                    .get('method_bar')!
                    .filter((r) => !r.marker && r.fileName.includes('build'))
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferSource'
    );
}
