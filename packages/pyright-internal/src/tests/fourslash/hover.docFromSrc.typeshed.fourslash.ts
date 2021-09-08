/// <reference path="fourslash.ts" />

// @filename: requests/__init__.pyi
// @library: true
//// from .api import head as head

// @filename: requests/api.pyi
// @library: true
//// def head(url, **kwargs) -> None:
////     r"""Sends a <HEAD> request."""
////     pass

// @filename: test.py
//// import requests
////
//// print(requests.[|/*marker*/head|](''))

helper.verifyHover('markdown', {
    marker: '```python\n(function) head: (url: Unknown, **kwargs: Unknown) -> None\n```\n---\nSends a &lt;HEAD&gt; request.',
});
