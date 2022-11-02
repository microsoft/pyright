/// <reference path="fourslash.ts" />

// @filename: pyrightconfig.json
//// {
////   "reportShadowedImports": "warning"
//// }

// @filename: random.py
// @library: true
//// def random():
////     pass

// @filename: curses/__init__.py
// @library: true
//// # Should make this more official

// @filename: curses/ascii.py
// @library: true
//// def stuff():
////     pass

// @filename: ctypes/util.py
// @library: true
//// def stuff():
////     pass

// @filename: random.py
//// def stuff():
////     pass

// @filename: curses/ascii.py
//// # This shouldn't cause a problem when referenced below because the below reference
//// # will look at the lib curses/ascii.py instead

// @filename: ctypes/util.py
//// [|/*marker1*/def foo():
////     ...|]

// @filename: ctypes/__init__.py
//// # This should be flagged as a module

// @filename: test.py
//// import [|/*marker2*/ctypes.util|]
//// [|from /*marker3*/ctypes.util import foo|]
//// import [|/*marker4*/ctypes.util as bar|]
//// import [|/*marker5*/random|]
//// import [|/*marker6*/curses.ascii as ascii|]
////
// @ts-ignore
await helper.verifyDiagnostics({
    marker1: {
        category: 'warning',
        message: `"\\ctypes\\util.py" is overriding the stdlib module "ctypes.util". Try renaming "\\ctypes\\util.py" to something else.`,
    },
    marker2: {
        category: 'warning',
        message: `"\\ctypes\\util.py" is overriding the stdlib module "ctypes.util". Try renaming "\\ctypes\\util.py" to something else.`,
    },
    marker3: {
        category: 'warning',
        message: `"\\ctypes\\util.py" is overriding the stdlib module "ctypes.util". Try renaming "\\ctypes\\util.py" to something else.`,
    },
    marker4: {
        category: 'warning',
        message: `"\\ctypes\\util.py" is overriding the stdlib module "ctypes.util". Try renaming "\\ctypes\\util.py" to something else.`,
    },
    marker5: {
        category: 'warning',
        message: `"\\random.py" is overriding the stdlib module "random". Try renaming "\\random.py" to something else.`,
    },
    marker6: {
        category: 'none',
        message: undefined,
    },
});
