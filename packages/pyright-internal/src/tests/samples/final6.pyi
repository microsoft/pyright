# This sample tests that an overloaded method in a stub honors the
# @final on the first overload.

from typing import final, overload

class ClassA:
    @overload
    @final
    def method1(self, x: int) -> int: ...
    @overload
    def method1(self, x: str) -> str: ...
    @overload
    def method2(self, x: int) -> int: ...
    @overload
    @final
    # This should generate an error because the first overload
    # is not marked @final but this one is.
    def method2(self, x: str) -> str: ...

class ClassB(ClassA):
    @overload
    def method1(self, x: int) -> int: ...
    @overload
    # This should generate an error.
    def method1(self, x: str) -> str: ...
