/// <reference path="fourslash.ts" />

// @filename: mspythonconfig.json
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

helper.verifyHover({
    marker1: { value: '```python\n(class) Validator\n```\nThe validator class', kind: 'markdown' },
    marker2: {
        value: '```python\n(method) is_valid: (text: str) -> bool\n```\nChecks if the input string is valid.',
        kind: 'markdown',
    },
    marker3: {
        value: '```python\n(property) read_only_prop: bool\n```\nThe read-only property.',
        kind: 'markdown',
    },
    marker4: {
        value: '```python\n(property) read_write_prop: bool\n```\nThe read-write property.',
        kind: 'markdown',
    },
    marker5: {
        value: '```python\n(property) read_write_prop: bool\n```\nThe read-write property.',
        kind: 'markdown',
    },
});
