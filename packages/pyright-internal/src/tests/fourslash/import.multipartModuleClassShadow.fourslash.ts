/// <reference path="typings/fourslash.d.ts" />

// This verifies that when a package re-exports (via wildcard) a name that is
// both an implicitly-imported submodule and a class/symbol of the same name,
// the class/symbol "wins" rather than being shadowed by the submodule.

// @filename: pkg/__init__.py
//// from .sub import *

// @filename: pkg/sub/__init__.py
//// from .ImageView import ImageView

// @filename: pkg/sub/ImageView.py
//// class ImageView:
////     pass

// @filename: test.py
//// from pkg import ImageView
////
//// # ImageView should resolve to the class, not the submodule, so it can be
//// # used as a type annotation and called.
//// view: ImageView = ImageView()
//// reveal_type(ImageView, expected_text="type[ImageView]")

// Companion case: a pure submodule re-export (no shadowing class) must still
// resolve as a module so that submodule member access remains available. This
// locks in that the multipart-alias behavior didn't regress.

// @filename: pkg2/__init__.py
//// from .sub2 import *

// @filename: pkg2/sub2/__init__.py
//// from . import mod

// @filename: pkg2/sub2/mod.py
//// def mod_func() -> None:
////     pass

// @filename: test2.py
//// import pkg2
////
//// # mod has only a submodule alias declaration, so it stays a module and its
//// # members remain accessible through the re-exported name.
//// pkg2.mod.mod_func()
//// reveal_type(pkg2.mod, expected_text='Module("..mod")')

helper.verifyDiagnostics();
