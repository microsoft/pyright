# This sample tests a case involving nested protocol types that was
# not working in a previous version of the type checker.

from typing import Protocol


class Proto1[T](Protocol):
    x: T


class Proto2[T](Protocol):
    @staticmethod
    def a() -> Proto1[T]: ...
    @classmethod
    def b(cls) -> list[T]: ...


class C[T]:
    @staticmethod
    def a() -> T: ...
    @classmethod
    def b[S](cls: type[Proto2[S]]) -> list[S]: ...


def test[S](x: type[Proto2[S]]): ...


test(C[Proto1[int]])
