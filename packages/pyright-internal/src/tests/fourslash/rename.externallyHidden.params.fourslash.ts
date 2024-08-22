/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// def __foo([|param/*marker*/|]: int):
////     pass
////
//// __foo([|param|]=1)

// @filename: test2.py
//// from test1 import __foo
////
//// __foo([|param|]=1)

helper.verifyRename({
    marker: {
        newName: 'param1',
        changes: helper
            .getRangesByText()
            .get('param')!
            .map((r) => {
                return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: 'param1' };
            }),
    },
});
