/// <reference path="fourslash.ts" />

// @filename: test1.py
//// os[|/*marker1*/|]

// @filename: test2.py
//// sys[|/*marker2*/|]

// @filename: test3.py
//// import os
//// import sys
//// a = os.path
//// b = sys.path

helper.openFile('/test1.py');

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'os',
                kind: Consts.CompletionItemKind.Module,
                documentation: '```\nimport os\n```',
                detail: 'Auto-import',
            },
        ],
    },
});

helper.openFile('/test2.py');

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker2: {
        completions: [
            {
                label: 'sys',
                kind: Consts.CompletionItemKind.Module,
                documentation: '```\nimport sys\n```',
                detail: 'Auto-import',
            },
        ],
    },
});
