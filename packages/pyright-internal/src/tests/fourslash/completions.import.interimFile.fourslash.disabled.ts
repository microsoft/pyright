/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// import al[|/*marker1*/|]

// @filename: altair/__init__.py
// @library: true
//// """module docstring"""
////
//// __all__ = [ "selection_interval" ]
////
//// from .vegalite import (
////     selection,
////     selection_interval
//// )

// @filename: altair/vegalite/__init__.py
// @library: true
//// def selection(): pass
//// def selection_interval(): pass

// @filename: altair/py.typed
// @library: true
//// # has to contain something for file to be written

{
    // Force interim file to be created
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                { label: 'altair', kind: Consts.CompletionItemKind.Module, documentation: 'module docstring' },
            ],
        },
    });

    helper.replace(helper.BOF, helper.getMarkerByName('marker1').position, 'import altair as alt\n\nalt.');

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [{ label: 'selection_interval', kind: Consts.CompletionItemKind.Function }],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker1: {
            completions: [{ label: 'selection', kind: Consts.CompletionItemKind.Function }],
        },
    });
}
