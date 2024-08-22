/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import lib
////
//// lib.[|/*marker1*/A|]()

// @filename: lib/__init__.pyi
// @library: true
//// class A(): ...

// @filename: lib/__init__.py
// @library: true
//// from ._lib import A

// @filename: lib/_lib.py
// @library: true
//// from ._type import A as mod_A
//// A = mod_A
//// "doc string for A"

// @filename: lib/_type.py
// @library: true
//// class A(): pass

helper.verifyHover('markdown', {
    marker1: '```python\nclass A()\n```\n---\ndoc string for A',
});
