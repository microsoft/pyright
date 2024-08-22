/// <reference path="typings/fourslash.d.ts" />

// @filename: typings/pkg1234/__init__.pyi
//// __version__: str

// @filename: importnotresolved.py
//// # will not resolve, stub found but source not found
////
//// import [|/*marker1*/pkg1234|]
//// print(pkg1234.__version__)

helper.verifyDiagnostics({
    marker1: {
        category: 'warning',
        message: 'Import "pkg1234" could not be resolved from source',
    },
});
