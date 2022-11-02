/// <reference path="fourslash.ts" />

// @filename: test.py
//// class Foo:
////     ''' Original doc string '''
////     pass
////
//// [|/*marker1*/A|] = Foo
//// ''' Alias doc string '''
////
//// def bar(x: [|/*marker2*/A|]):
////     pass
////
//// class Baz:
////     pass
////
//// [|/*marker3*/B|] = Baz
//// ''' Alias alone doc string '''

helper.verifyHover('markdown', {
    marker1: '```python\n(type alias) A: Type[Foo]\n```\n---\nAlias doc string\n\nOriginal doc string',
    marker2: '```python\n(type alias) A: Type[Foo]\n```\n---\nAlias doc string\n\nOriginal doc string',
    marker3: '```python\n(type alias) B: Type[Baz]\n```\n---\nAlias alone doc string',
});
