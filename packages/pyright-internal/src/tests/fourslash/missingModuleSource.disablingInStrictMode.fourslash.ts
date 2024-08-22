/// <reference path="typings/fourslash.d.ts" />

// @filename: typings/pkg1234/__init__.pyi
//// __version__: str

// @filename: importnotresolved.py
//// #pyright: strict
////
//// # verify that reportMissingModuleSource can be disabled via config
//// # even when in strict mode
////
//// import pkg1234
//// print(pkg1234.__version__)

// @filename: pyrightconfig.json
//// {
////   "reportMissingModuleSource": false
//// }

helper.verifyDiagnostics({});
