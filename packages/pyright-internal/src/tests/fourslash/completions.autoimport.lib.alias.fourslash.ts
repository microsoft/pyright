/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// [|/*import*/|][|job/*marker*/|]

// @filename: test2.py
//// import dagster

// @filename: dagster/py.typed
// @library: true
//// partial

// @filename: dagster/__init__.py
// @library: true
//// from dagster.core.definitions import (
////     job
//// )
////
//// __all__ = [
////    "job"
//// ]

// @filename: dagster/core/__init__.py
// @library: true
//// from builtins import *

// @filename: dagster/core/definitions/__init__.py
// @library: true
//// from .decorators import (
////    job
//// )

// @filename: dagster/core/definitions/decorators/__init__.py
// @library: true
//// from .job_decorator import job

// @filename: dagster/core/definitions/decorators/job_decorator.py
// @library: true
//// def job():
////     ...

{
    const importRange = helper.getPositionRange('import');
    const markerRange = helper.getPositionRange('marker');

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker: {
            completions: [
                {
                    label: 'job',
                    kind: Consts.CompletionItemKind.Function,
                    documentation: '```\nfrom dagster import job\n```',
                    detail: 'Auto-import',
                    textEdit: { range: markerRange, newText: 'job' },
                    additionalTextEdits: [{ range: importRange, newText: 'from dagster import job\n\n\n' }],
                },
            ],
        },
    });
}
