/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// class ClassWithGetterDocs(object):
////     def __init__(self, length):
////         self._length = length
////
////     @property
////     def length(self):
////         """
////         read property doc
////         """
////         return self._length
////
////     @length.setter
////     def length(self, value):
////         pass
////
//// one = ClassWithGetterDocs(3)
//// one.lengt[|/*marker1*/|]
////
//// class ClassWithSetterDocs(object):
////     def __init__(self, length):
////         self._length = length
////
////     @property
////     def length(self):
////         return self._length
////
////     @length.setter
////     def length(self, value):
////         """
////         setter property doc
////         """
////         pass
////
//// two = ClassWithSetterDocs(3)
//// two.lengt[|/*marker2*/|]
// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'length',
                kind: Consts.CompletionItemKind.Property,
                documentation: '```python\nlength: Unknown (property)\n```\n---\nread property doc',
            },
        ],
    },
    marker2: {
        completions: [
            {
                label: 'length',
                kind: Consts.CompletionItemKind.Property,
                documentation: '```python\nlength: Unknown (property)\n```\n---\nsetter property doc',
            },
        ],
    },
});
