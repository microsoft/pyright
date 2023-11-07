# This sample tests the case where a protocol class is used within a mixin
# class method that calls super().

from typing import Protocol


class MixinProt(Protocol):
    def method1(self) -> int:
        ...


class MyMixin:
    def get(self: MixinProt) -> None:
        x = super().method1()
        reveal_type(x, expected_text="int")
