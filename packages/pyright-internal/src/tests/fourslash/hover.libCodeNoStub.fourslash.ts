/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib/__init__.py
// @library: true
//// class Validator:
////     '''The validator class'''
////     def is_valid(self, text: str) -> bool:
////         '''Checks if the input string is valid.'''
////         return True
////     @property
////     def read_only_prop(self) -> bool:
////         '''The read-only property.'''
////         return True
////     @property
////     def read_write_prop(self) -> bool:
////         '''The read-write property.'''
////         return True
////     @read_write_prop.setter
////     def read_write_prop(self, val: bool):
////         pass

// @filename: test.py
//// import testLib
//// obj = testLib.[|/*marker1*/Validator|]()
//// obj.[|/*marker2*/is_valid|]('')
//// obj.[|/*marker3*/read_only_prop|]
//// r = obj.[|/*marker4*/read_write_prop|]
//// obj.[|/*marker5*/read_write_prop|] = r

helper.verifyHover('markdown', {
    marker1: '```python\nclass Validator()\n```\n---\nThe validator class',
    marker2: '```python\n(method) def is_valid(text: str) -> bool\n```\n---\nChecks if the input string is valid.',
    marker3: '```python\n(property) read_only_prop: bool\n```\n---\nThe read-only property.',
    marker4: '```python\n(property) read_write_prop: bool\n```\n---\nThe read-write property.',
    marker5: '```python\n(property) read_write_prop: bool\n```\n---\nThe read-write property.',
});
