/// <reference path="typings/fourslash.d.ts" />

// @filename: foo/__init__.py
//// class Foo:
////    pass

// @filename: test.py
//// import foo
//// [|/*marker*/foo|] = 3
//// def [|foo|](): pass

const ranges = helper.getRanges();

helper.verifyRename({
    marker: {
        newName: 'foo1',
        changes: ranges.map((r) => {
            return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: 'foo1' };
        }),
    },
});
