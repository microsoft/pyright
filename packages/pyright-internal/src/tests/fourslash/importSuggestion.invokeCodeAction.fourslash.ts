/// <reference path="fourslash.ts" />

// @filename: pyrightconfig.json
//// {}

// @filename: test.py
//// [|/*import*/|]foo: TracebackType[|/*marker*/|]

const importRange = helper.getPositionRange('import');

//@ts-expect-error https://github.com/DetachHead/basedpyright/issues/86
await helper.verifyCodeActions('included', {
    marker: {
        codeActions: [
            {
                title: `from types import TracebackType`,
                edit: {
                    changes: {
                        'file:///test.py': [{ range: importRange, newText: 'from types import TracebackType\n\n\n' }],
                    },
                },
                kind: 'quickfix',
            },
        ],
    },
});
