/// <reference path="fourslash.ts" />
// @asynctest: true

// @filename: mspythonconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib/__init__.pyi
// @library: true
//// class Validator:
////     '''The validator class'''
////     def is_valid(self, text: str) -> bool:
////         '''Checks if the input string is valid.'''
////         pass

// @filename: test.py
//// import testLib
//// obj = testLib.[|/*marker1*/Validator|]()
//// obj.is[|/*marker2*/|]

helper.verifyCompletion('included', {
    marker1: {
        completions: [
            {
                label: 'Validator',
                documentation: {
                    kind: 'markdown',
                    value: '```python\nclass Validator()\n```\n---\nThe validator class',
                },
            },
        ],
    },
    marker2: {
        completions: [
            {
                label: 'is_valid',
                documentation: {
                    kind: 'markdown',
                    value:
                        '```python\nis_valid: (self: Validator, text: str) -> bool\n```\n---\nChecks if the input string is valid.',
                },
            },
        ],
    },
});
