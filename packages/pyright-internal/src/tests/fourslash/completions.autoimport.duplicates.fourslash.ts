/// <reference path="typings/fourslash.d.ts" />
// @indexer: true

// @filename: test1.py
//// import math
//// import testLib
//// [|ata/*marker*/|]

// @filename: testLib/__init__.pyi
// @library: true
//// def atan(x: float) -> float: ...
{
    const markerRange = helper.getPositionRange('marker');

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker: {
            completions: [
                {
                    label: 'atan',
                    kind: Consts.CompletionItemKind.Function,
                    documentation: '```\nfrom math import atan\n```',
                    detail: 'Auto-import',
                    textEdit: { range: markerRange, newText: 'math.atan' },
                },
                {
                    label: 'atan',
                    kind: Consts.CompletionItemKind.Function,
                    documentation: '```\nfrom testLib import atan\n```',
                    detail: 'Auto-import',
                    textEdit: { range: markerRange, newText: 'testLib.atan' },
                },
            ],
        },
    });
}
