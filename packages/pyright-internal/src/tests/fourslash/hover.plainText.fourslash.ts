/// <reference path="fourslash.ts" />

// @filename: test.py
//// class [|/*marker1*/Validator|]:
////     '''The validator class
////
////     .. versionadded:: 2.0
////         This directive shows in plaintext.
////     '''
////     def is_valid(self, text: str) -> bool:
////         '''Checks if the input string is valid.'''
////         return true
////
//// validator = Validator()
//// validator.[|/*marker2*/is_valid|]('hello')

helper.verifyHover('plaintext', {
    marker1:
        '(class) Validator\n\nThe validator class\n\n.. versionadded:: 2.0\n    This directive shows in plaintext.',
    marker2: '(method) is_valid: (text: str) -> bool\n\nChecks if the input string is valid.',
});
