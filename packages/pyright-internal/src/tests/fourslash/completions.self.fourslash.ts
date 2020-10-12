/// <reference path="fourslash.ts" />

// @filename: test.py
//// class Foo:
////     def __init__(self):
////         self.var1 = 3
////     def method1(self):
////         '''Method 1.'''
////         pass
////     @property
////     def prop1(self):
////         '''Property 1.'''
////         return 2
////     def new_method(self):
////         self.[|/*marker1*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'method1',
                documentation: '```python\nmethod1: () -> None\n```\n---\nMethod 1.',
            },
            {
                label: 'new_method',
                documentation: '```python\nnew_method: () -> None\n```\n',
            },
            {
                label: 'prop1',
                documentation: '```python\nprop1: Literal[2] (property)\n```\n---\nProperty 1.',
            },
            {
                label: 'var1',
                documentation: '```python\nvar1: int\n```\n',
            },
        ],
    },
});
