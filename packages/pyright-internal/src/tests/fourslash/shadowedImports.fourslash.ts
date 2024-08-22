/// <reference path="typings/fourslash.d.ts" />

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
//// [|/*marker7*/def stuff():
////     pass|]

// @filename: __main__.py
//// [|/*marker10*/def something():
////     pass|]

// @filename: curses/ascii.py
//// [|/*marker8*/# This shouldn't cause a problem when referenced below because the below reference
//// # will look at the lib curses/ascii.py instead|]

// @filename: ctypes/util.py
//// [|/*marker1*/def foo():
////     ...|]

// @filename: ctypes/__init__.py
//// # This should be flagged as a module

// @filename: test.py
//// import [|/*marker2*/ctypes.util|]
//// [|from /*marker3*/ctypes.util import find_library|]
//// import [|/*marker4*/ctypes.util as bar|]
//// import [|/*marker5*/random|]
//// import [|/*marker6*/curses.ascii as ascii|]
//// from  [|/*marker9*/.random import stuff|] # Relative should be okay
////
// @ts-ignore
await helper.verifyDiagnostics({
    marker1: {
        category: 'warning',
        message: `"${helper.getPathSep()}ctypes${helper.getPathSep()}util.py" is overriding the stdlib module "ctypes.util"`,
    },
    marker2: {
        category: 'warning',
        message: `"${helper.getPathSep()}ctypes${helper.getPathSep()}util.py" is overriding the stdlib module "ctypes.util"`,
    },
    marker3: {
        category: 'warning',
        message: `"${helper.getPathSep()}ctypes${helper.getPathSep()}util.py" is overriding the stdlib module "ctypes.util"`,
    },
    marker4: {
        category: 'warning',
        message: `"${helper.getPathSep()}ctypes${helper.getPathSep()}util.py" is overriding the stdlib module "ctypes.util"`,
    },
    marker5: {
        category: 'warning',
        message: `"${helper.getPathSep()}random.py" is overriding the stdlib module "random"`,
    },
    marker6: {
        category: 'none',
        message: undefined,
    },
    marker7: {
        category: 'warning',
        message: `"${helper.getPathSep()}random.py" is overriding the stdlib module "random"`,
    },
    marker8: {
        category: 'warning',
        message: `"${helper.getPathSep()}curses${helper.getPathSep()}ascii.py" is overriding the stdlib module "curses.ascii"`,
    },
    marker9: {
        category: 'none',
        message: undefined,
    },
    marker10: {
        category: 'none',
        message: undefined,
    },
});
