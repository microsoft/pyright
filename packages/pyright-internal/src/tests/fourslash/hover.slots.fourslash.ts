/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Chat:
////    __slots__ = ("id",)
////
////    def __init__(self):
////        self.id = 1234
////        """The ID of the channel."""
////
//// y = Chat()
//// y.[|/*marker*/id|]
helper.verifyHover('markdown', {
    marker: '```python\n(variable) id: int\n```\n---\nThe ID of the channel.',
});
