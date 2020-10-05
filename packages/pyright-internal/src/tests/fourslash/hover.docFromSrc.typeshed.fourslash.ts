/// <reference path="fourslash.ts" />

// @filename: requests/__init__.py
// @library: true
//// from .api import head

// @filename: requests/api.py
// @library: true
//// def head(url, **kwargs):
////     r"""Sends a <HEAD> request."""
////     pass

// @filename: test.py
//// import requests
////
//// print(requests.[|/*marker*/head|](''))

helper.verifyHover({
    marker: {
        value:
            '```python\n(function) head: (url: str | bytes, **kwargs: Unknown) -> Response\n```\nSends a &lt;HEAD&gt; request.',
        kind: 'markdown',
    },
});
