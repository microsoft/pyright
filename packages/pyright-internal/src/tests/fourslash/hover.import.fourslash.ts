/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// import [|/*marker*/library|]

// @filename: library/__init__.py
//// '''documentation for library'''

helper.verifyHover('markdown', {
    marker: '```python\n(module) library\n```\n---\ndocumentation for library',
});
