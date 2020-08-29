# This sample tests support for comment-style function annotations
# that include extra annotations for the "self" or "cls" parameters.

from typing import TypeVar


_T = TypeVar("_T", bound="ClassA")

class ClassA:
    def method0(self, a, b):
        # type: (_T, str, int) -> str
        return ""

    # Too many annotations
    def method2(self, a, b): # type: (_T, str, int, int) -> str
        return ""

    # Too few annotations
    @staticmethod
    def method3(a, b):
        # type: (int) -> str
        return ""


