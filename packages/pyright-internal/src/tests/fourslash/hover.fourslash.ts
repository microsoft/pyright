/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class [|/*marker1*/Validator|]:
////     '''The validator class
////
////     .. versionadded:: 2.0
////         This directive does not show in hover.
////     '''
////     def is_valid(self, text: str) -> bool:
////         '''Checks if the input string is valid.'''
////         return true
////
//// validator = Validator()
//// validator.[|/*marker2*/is_valid|]('hello')

helper.verifyHover('markdown', {
    marker1: '```python\n(class) Validator\n```\n---\nThe validator class',
    marker2: '```python\n(method) def is_valid(text: str) -> bool\n```\n---\nChecks if the input string is valid.',
});
