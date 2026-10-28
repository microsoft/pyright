/// <reference path="typings/fourslash.d.ts" />

// @filename: offsets/py.typed
// @library: true
//// partial

// @filename: offsets/__init__.py
// @library: true
//// class Base:
////     def __add__(self, other: object):
////         return self.apply(other)
////
////     def __radd__(self, other: object):
////         return self.apply(other)
////
////     def apply(self, other: object):
////         return NotImplemented
////
//// class Number(Base):
////     def apply(self, other: object) -> int:
////         return 42
////
//// class Text(Base):
////     def apply(self, other: object) -> str:
////         return "value"

// @filename: test.py
//// from offsets import Base, Number, Text
////
//// def results(number: Number, text: Text, base: Base):
////     [|/*number*/number_result|] = number + number
////     [|/*text*/text_result|] = text + text
////     [|/*reflected*/reflected_result|] = base + number

helper.verifyDiagnostics({
    number: { category: 'none', message: '' },
    text: { category: 'none', message: '' },
    reflected: { category: 'none', message: '' },
});
helper.verifyHover('markdown', {
    number: '```python\n(variable) number_result: int\n```',
    text: '```python\n(variable) text_result: str\n```',
    reflected: '```python\n(variable) reflected_result: int\n```',
});
