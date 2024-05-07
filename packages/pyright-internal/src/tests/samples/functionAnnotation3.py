# This sample tests support for comment-style function annotations
# that include extra annotations for the "self" or "cls" parameters.

from typing import TypeVar


_T = TypeVar("_T", bound="ClassA")


class ClassA:
    foo: str

    def method0(self, a, b):
        # type: (_T, str, list[_T]) -> str
        return self.foo

    def method1(self, a, b):
        # type: (_T, str, list[_T]) -> ClassB
        return ClassB()

    # Too many annotations
    def method2(self, a, b):  # type: (_T, str, int, list[_T]) -> str
        return ""

    # Too few annotations
    @staticmethod
    def method3(a, b):
        # type: (int) -> str
        return ""

    def method4(self, a, b):
        # type: (str, ClassB) -> str
        return self.foo


class ClassB: ...
