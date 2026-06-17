/// <reference path="typings/fourslash.d.ts" />

// Importing a submodule of a native extension that ships type stubs should NOT
// emit a spurious `reportMissingModuleSource` warning. The package is an
// installed (library) native extension: a `.pyd`/`.so` backs the parent module
// and `.pyi` stubs describe the submodules. A compiled extension has no Python
// source, but the runtime module DOES exist (the native lib), so the warning is
// meaningless.
//
// Faithful layout note: the native lib, the package source, and the stubs are
// all co-located in the same (library) search root, mirroring an installed
// package. Marking each file `@library: true` keeps them together in the
// library folder (and out of the harness source-file checks).

// @filename: nativelib/__init__.py
// @library: true
//// # Regular installed-package source for the top-level package.

// @filename: nativelib/color.pyd
// @library: true
//// # Native library backing the `color` submodule (compiled extension).

// @filename: nativelib/color/__init__.pyi
// @library: true
//// # Stub package for the native `color` module.

// @filename: nativelib/color/style.pyi
// @library: true
//// def make_style() -> int: ...

// @filename: stubonlylib/__init__.pyi
// @library: true
//// # Stub-only package: no source, no native lib (control case).

// @filename: stubonlylib/missing.pyi
// @library: true
//// def helper() -> int: ...

// @filename: test.py
//// # --- visitModuleName path (`import a.b.c` / `from a.b.c import name`) ---
//// # Submodule of a native extension: stubs + native parent lib -> NO warning.
//// import nativelib.color.style
//// from nativelib.color.style import make_style
////
//// # --- visitImportFromAs submoduleFallback path (`from pkg import submodule`) ---
//// # Native-backed submodule imported as a name: the `style` alias resolves to a stub
//// # (`color/style.pyi`) while the native `color.pyd` sits mid-path, so the non-stub
//// # resolution reports isNativeLib. Exercises the second guard call site -> NO warning.
//// from nativelib.color import style
////
//// # Stub-only submodule imported as a name -> warning MUST still fire (regression guard
//// # for the visitImportFromAs call site).
//// from stubonlylib import [|/*marker2*/missing|]
////
//// # Stub-only dotted module (visitModuleName control) -> warning MUST still fire.
//// from [|/*marker1*/stubonlylib.missing|] import helper

helper.verifyDiagnostics({
    marker1: {
        category: 'warning',
        message: 'Import "stubonlylib.missing" could not be resolved from source',
    },
    marker2: {
        category: 'warning',
        message: 'Import "stubonlylib.missing" could not be resolved from source',
    },
});
