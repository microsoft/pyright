/// <reference path="typings/fourslash.d.ts" />

// This verifies that when a package re-exports (via wildcard) a name that is
// both an implicitly-imported submodule and a class/symbol of the same name,
// the class/symbol "wins" rather than being shadowed by the submodule.
// See https://github.com/microsoft/pyright/issues/11481.

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

helper.verifyDiagnostics();
