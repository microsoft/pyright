/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class ClassA:
////     ''' ClassA doc string '''
////     pass
////
//// [|/*marker1*/AliasA|] = ClassA
//// ''' AliasA doc string '''
////
//// def func1(x: [|/*marker2*/AliasA|]):
////     pass
////
//// class ClassB:
////     pass
////
//// [|/*marker3*/AliasB|] = ClassB
//// ''' AliasB alone doc string '''
////
//// class ClassC:
////    """ ClassC doc string """
////    pass
////
//// [|/*marker4*/AliasC|] = ClassC
//// ''' AliasC doc string '''
////
//// class ClassD:
////     pass
////
//// [|/*marker5*/AliasD|] = ClassD
//// ''' AliasD alone doc string '''
////

helper.verifyHover('markdown', {
    marker1: '```python\n(type) AliasA = ClassA\n```\n---\nAliasA doc string\n\nClassA doc string',
    marker2: '```python\n(type) AliasA = ClassA\n```\n---\nAliasA doc string\n\nClassA doc string',
    marker3: '```python\n(type) AliasB = ClassB\n```\n---\nAliasB alone doc string',
    marker4: '```python\n(type) AliasC = ClassC\n```\n---\nAliasC doc string\n\nClassC doc string',
    marker5: '```python\n(type) AliasD = ClassD\n```\n---\nAliasD alone doc string',
});
