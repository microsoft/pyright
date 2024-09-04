/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "pythonVersion": "3.14"
//// }

// @filename: test.py
//// def func1([|/*marker1*/val|]: float | str):
////    return 1
////
//// def func2([|/*marker2*/val|]: int):
////   func1([|/*marker3*/val=|])

{
    const marker1 = helper.getMarkerByName('marker1');
    const marker2 = helper.getMarkerByName('marker2');
    const marker3 = helper.getMarkerByName('marker3');

    helper.verifyRename({
        marker1: {
            newName: 'x',
            changes: helper
                .getRanges()
                .filter((r) => r.marker === marker1 || r.marker === marker3)
                .map((r) => {
                    const result = {
                        filePath: r.fileName,
                        range: helper.convertPositionRange(r),
                        replacementText: 'x',
                    };
                    if (r.marker === marker3) {
                        result.replacementText = 'x=val';
                    }
                    return result;
                }),
        },
        marker2: {
            newName: 'x',
            changes: helper
                .getRanges()
                .filter((r) => r.marker === marker2 || r.marker === marker3)
                .map((r) => {
                    const result = {
                        filePath: r.fileName,
                        range: helper.convertPositionRange(r),
                        replacementText: 'x',
                    };
                    if (r.marker === marker3) {
                        result.replacementText = 'val=x';
                    }
                    return result;
                }),
        },
        marker3: {
            newName: 'x',
            changes: helper
                .getRanges()
                .filter((r) => r.marker === marker1 || r.marker === marker3)
                .map((r) => {
                    const result = {
                        filePath: r.fileName,
                        range: helper.convertPositionRange(r),
                        replacementText: 'x',
                    };
                    if (r.marker === marker3) {
                        result.replacementText = 'x=val';
                    }
                    return result;
                }),
        },
    });
}
