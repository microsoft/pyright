/// <reference path="typings/fourslash.d.ts" />

// @filename: pkg/__init__.py
//// from . import util

// @filename: pkg/util/__init__.py
////

// @filename: pkg/util/foo.py
//// class Foo:
////     pass

// @filename: test.py
//// import pkg
//// import pkg.util.foo
//// pkg.util.foo.[|/*marker*/Foo|]()

// @ts-ignore
helper.verifyHover('markdown', {
    marker: '```python\nclass Foo()\n```',
});
