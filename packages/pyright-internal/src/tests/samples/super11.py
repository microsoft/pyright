# This sample tests the case where a protocol class is used within a mixin
# class method that calls super().

from typing import Protocol, overload


class MixinProt(Protocol):
    def method1(self) -> int:
        """This is not implemented"""
        raise NotImplementedError

    def method2(self) -> int:
        return 1

    @overload
    def method3(self, x: int) -> int: ...

    @overload
    def method3(self, x: str) -> str: ...

    @overload
    def method4(self, x: int) -> int: ...

    @overload
    def method4(self, x: str) -> str: ...

    def method4(self, x: int | str) -> int | str:
        return ""


class MyMixin:
    def get(self: MixinProt) -> None:
        m1 = super().method1()
        reveal_type(m1, expected_text="int")

        m2 = super().method2()

        m3 = super().method3(1)

        m4 = super().method4(2)
