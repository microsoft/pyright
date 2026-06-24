/// <reference path="typings/fourslash.d.ts" />

// A package shipped as a "sourceless distribution": a compiled `.pyc` module sits
// where the `.py` source would be (directly beside its `.pyi` stub, NOT under
// `__pycache__`), with no `.py` file. Python imports such a `.pyc` directly, so the
// module exists at runtime even though it has no Python source. The
// `reportMissingModuleSource` warning ("could not be resolved from source") is
// therefore misleading and should NOT fire.
//
// This mirrors the native-extension case (a `.pyd`/`.so` backing a `.pyi` stub):
// a compiled implementation with no Python source is still a real runtime module.

// --- Top-level compiled module: `mod.pyc` beside `mod.pyi`, no `mod.py`. ---
// @filename: compiledmod.pyi
// @library: true
//// VALUE: int

// @filename: compiledmod.pyc
// @library: true
//// # Compiled bytecode placeholder. Only the file's presence matters to import
//// # resolution; the text content is never parsed.

// --- Compiled package + compiled submodule: `__init__.pyc`/`sub.pyc` beside the
//     stubs, no `.py` anywhere. Exercises the package (`__init__`) layout and the
//     dotted/submodule resolution paths.
//
//     Note: `import compiledpkg` itself does NOT exercise the new `.pyc` branch --
//     the non-stub pass resolves the package via the pre-existing namespace-package
//     directory fallback (`foundDirectory` -> `isImportFound`), and `__init__.pyc`
//     is never probed. The genuinely new-branch cases are the top-level
//     `compiledmod` and the submodule `compiledpkg.sub` (dotted + `from ... import`). ---
// @filename: compiledpkg/__init__.pyi
// @library: true
//// PKGVALUE: int

// @filename: compiledpkg/__init__.pyc
// @library: true
//// # Compiled bytecode placeholder for the package __init__.

// @filename: compiledpkg/sub.pyi
// @library: true
//// SUBVALUE: int

// @filename: compiledpkg/sub.pyc
// @library: true
//// # Compiled bytecode placeholder for the submodule.

// --- Compiled module WITHOUT a stub (`.pyc` only, no `.pyi`/`.py`). The `.pyc`
//     branch is gated on `!allowPyi`, so the stub (primary) resolution must still
//     fail here and `reportMissingImports` must fire. Regression guard. ---
// @filename: pyconlymod.pyc
// @library: true
//// # Compiled bytecode placeholder; there is no stub for this module.

// --- `isLastPart` gate guard: a `.pyc` at a NON-leaf (mid-path) position must NOT
//     partially resolve a dotted import. `midpathmod.pyc` exists but there is no
//     `midpathmod/` package directory, so `import midpathmod.sub` must still fail
//     with reportMissingImports. The new branch is gated on `isLastPart`, so a
//     mid-path `.pyc` can never satisfy a non-leaf component. ---
// @filename: midpathmod.pyc
// @library: true
//// # Compiled bytecode placeholder at a mid-path position; no package directory.

// --- Stub-only controls (no `.pyc`, no `.py`): `reportMissingModuleSource` MUST
//     still fire for both a top-level module and a submodule. ---
// @filename: stubonlymod.pyi
// @library: true
//// HELPER: int

// @filename: stubonlypkg/__init__.pyi
// @library: true
//// # Stub-only package (control).

// @filename: stubonlypkg/missing.pyi
// @library: true
//// def helper() -> int: ...

// @filename: test.py
//// # Compiled `.pyc` sits beside the `.pyi` stub (no `.py`) -> NO warning.
//// from compiledmod import VALUE
//// import compiledmod
////
//// # Compiled package (`__init__.pyc` beside `__init__.pyi`, no `__init__.py`) -> NO warning.
//// import compiledpkg
//// from compiledpkg import PKGVALUE
////
//// # Compiled submodule, dotted (visitModuleName path) -> NO warning.
//// import compiledpkg.sub
//// from compiledpkg.sub import SUBVALUE
////
//// # Compiled submodule imported as a name (visitImportFromAs submoduleFallback) -> NO warning.
//// from compiledpkg import sub
////
//// # `.pyc` only, no stub: primary (stub) resolution must still fail -> reportMissingImports.
//// import [|/*markerMissing*/pyconlymod|]
////
//// # Mid-path `.pyc` (no package directory): dotted import must still fail (isLastPart gate).
//// import [|/*markerMidpath*/midpathmod.sub|]
////
//// # Stub-only module (no `.pyc`, no `.py`) -> warning MUST still fire (control).
//// from [|/*marker1*/stubonlymod|] import HELPER
//// import [|/*marker2*/stubonlymod|]
////
//// # Stub-only submodule (no `.pyc`, no `.py`) -> warning MUST still fire (control).
//// from [|/*marker3*/stubonlypkg.missing|] import helper
//// from stubonlypkg import [|/*marker4*/missing|]

helper.verifyDiagnostics({
    markerMissing: {
        category: 'error',
        message: 'Import "pyconlymod" could not be resolved',
    },
    markerMidpath: {
        category: 'error',
        message: 'Import "midpathmod.sub" could not be resolved',
    },
    marker1: {
        category: 'warning',
        message: 'Import "stubonlymod" could not be resolved from source',
    },
    marker2: {
        category: 'warning',
        message: 'Import "stubonlymod" could not be resolved from source',
    },
    marker3: {
        category: 'warning',
        message: 'Import "stubonlypkg.missing" could not be resolved from source',
    },
    marker4: {
        category: 'warning',
        message: 'Import "stubonlypkg.missing" could not be resolved from source',
    },
});
