/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "exclude": ["**/exclude/**"]
//// }

// @filename: exclude/test.py
//// class [|/*marker1*/A|]:
////     pass
////
//// a = [|A|]()

// @filename: exclude/test2.py
//// class [|/*marker2*/B|]:
////     pass
////
//// b = [|B|]()

{
    helper.openFile(helper.getMarkerByName('marker1').fileName);

    // excluded file opened
    helper.verifyRename({
        marker1: {
            newName: 'RenamedA',
            changes: helper
                .getRangesByText()
                .get('A')!
                .map((r) => {
                    return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: 'RenamedA' };
                }),
        },
    });

    // excluded file closed
    helper.verifyRename({
        marker2: {
            newName: 'RenamedB',
            changes: [],
        },
    });
}
