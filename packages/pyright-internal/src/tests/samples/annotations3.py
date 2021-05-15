# This sample tests the handling of type annotations within a
# python source file with the __future__ annotations symbol present.

from __future__ import annotations

from typing import Optional


class ClassA:
    # This should generate an error because ClassA
    # is not yet defined at the time it's used.
    def func0(self) -> Optional[ClassA]:
        return None


class ClassB(ClassA):
    def func1(self) -> ClassA:
        return ClassA()

    # This should generate an error because ClassC
    # is a forward reference, which is not allowed
    # in a python source file.
    def func2(self) -> Optional[ClassC]:
        return None

    def func3(self) -> "Optional[ClassC]":
        return None

    def func4(self) -> Optional["ClassC"]:
        return None


class ClassC:
    pass
