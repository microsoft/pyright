/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import testLib
//// class ChildGetterDocs(testLib.ClassWithGetterDocs):
////     def __init__(self, length):
////         self._length = length
////
////     @property
////     def length(self):
////         return self._length
////
////     @length.setter
////     def length(self, value):
////         pass
////
//// class ChildSetterDocs(testLib.ClassWithSetterDocs):
////     def __init__(self, length):
////         self._length = length
////
////     @property
////     def length(self):
////         return self._length
////
////     @length.setter
////     def length(self, value):
////         pass
////
//// one = ChildGetterDocs(3)
//// one.lengt[|/*marker1*/|]
//// two = ChildSetterDocs(3)
//// two.lengt[|/*marker2*/|]

// @filename: testLib/__init__.py
// @library: true
//// class ClassWithGetterDocs(object):
////     def __init__(self, length):
////         self._length = length
////
////     @property
////     def length(self):
////         return self._length
////
////     @length.setter
////     def length(self, value):
////         pass
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
////         pass
////

// @filename: testLib/__init__.pyi
// @library: true
//// class ClassWithGetterDocs(object):
////     @property
////     def length(self) -> int:
////         """
////         read property doc
////         """
////         ...
////     @length.setter
////     def length(self, value) -> None: ...
////
//// class ClassWithSetterDocs(object):
////     @property
////     def length(self) -> int: ...
////     @length.setter
////     def length(self, value) -> None:
////         """
////         setter property doc
////         """
////         ...

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
