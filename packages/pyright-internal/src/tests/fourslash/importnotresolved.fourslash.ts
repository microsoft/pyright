/// <reference path="typings/fourslash.d.ts" />

// @filename: importnotresolved.py
//// # these will not be resolve, no typestubs for django in typeshed
////
//// import [|/*marker1*/notexistant|]
//// import [|/*marker2*/django|]
////

helper.verifyDiagnostics({
    marker1: { category: 'error', message: `Import "notexistant" could not be resolved` },
    marker2: { category: 'error', message: `Import "django" could not be resolved` },
});
