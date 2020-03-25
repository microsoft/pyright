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
////         return true

// @filename: test.py
//// import testLib
//// obj = testLib.[|/*marker1*/Validator|]()
//// obj.[|/*marker2*/is_valid|]('')

helper.verifyHover({
    marker1: { value: '```python\n(class) Validator\n```\nThe validator class', kind: 'markdown' },
    marker2: {
        value: '```python\n(method) is_valid: (text: str) -> bool\n```\nChecks if the input string is valid.',
        kind: 'markdown'
    }
});
