/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from django.view import generic
//// generic.[|/*marker*/TemplateView|]

// @filename: django/__init__.py
//// '''documentation for library'''

// @filename: django/view/__init__.py
//// from .generic.base import View
//// __all__ = ['View']

// @filename: django/view/generic/__init__.py
//// from .base import (View, TemplateView)
//// __all__ = ['View', 'TemplateView']

// @filename: django/view/generic/base.py
//// class View():
////     pass
////
//// class TemplateView():
////     pass

helper.verifyHover('markdown', {
    marker: '```python\n(class) TemplateView\n```',
});
