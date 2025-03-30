# This sample tests the handling of type annotations within a
# python source file with the __future__ annotations symbol present.

from __future__ import annotations

from typing import Optional


class ClassA:
    def func0(self) -> Optional[ClassA]:
        return None


class ClassB(ClassA):
    def func1(self) -> ClassA:
        return ClassA()

    def func2(self) -> Optional[ClassC]:
        return None

    def func3(self) -> "Optional[ClassC]":
        return None

    def func4(self) -> Optional["ClassC"]:
        return None

    def func5(self, x: ClassA):
        x.func0()

    class ClassA: ...

    def func6(self, x: ClassC):
        x.my_int


class ClassC:
    my_int: int
