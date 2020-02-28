/// <reference path="fourslash.ts" />

// @filename: test.py
//// class [|/*marker1*/Validator|]:
////     '''The validator class
////
////     .. versionadded:: 2.0
////         This directive does not show in hover.
////     '''
////     def IsValid(self, text: str) -> bool:
////         '''Checks if the input string is valid.'''
////         return true
////
//// validator = Validator()
//// validator.[|/*marker2*/IsValid|]('hello')

helper.verifyHover({
    marker1: { value: '```python\n(class) Validator\n```\nThe validator class', kind: 'markdown' },
    marker2: {
        value: '```python\n(method) IsValid: (text: str) -> bool\n```\nChecks if the input string is valid.',
        kind: 'markdown'
    }
});
