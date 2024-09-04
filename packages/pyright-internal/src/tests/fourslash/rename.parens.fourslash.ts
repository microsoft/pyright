/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// [|/*marker*/A|] = True
//// if([|A|]):
////     pass

{
    helper.verifyRename({
        marker: {
            newName: 'RenamedA',
            changes: helper
                .getRangesByText()
                .get('A')!
                .map((r) => {
                    return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: 'RenamedA' };
                }),
        },
    });
}
