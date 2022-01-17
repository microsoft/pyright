# This sample tests the case where a method is invoked on a
# generic class that is not specialized prior to binding to
# the method but is specialized implicitly via the arguments
# to the method.

from typing import Generic, TypeVar

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


class Foo(Generic[_T1]):
    @staticmethod
    def func1(value: _T1) -> "Foo[_T1]":
        return Foo[_T1]()

    @classmethod
    def func2(cls, value: _T1) -> "Foo[_T1]":
        return cls()


class FooSub1(Foo[_T2]):
    pass


class FooSub2(Foo[int]):
    pass


def test1(val_str: str, val_int: int):
    reveal_type(Foo.func1(val_str), expected_text="Foo[str]")
    reveal_type(FooSub1.func1(val_str), expected_text="Foo[str]")
    reveal_type(FooSub2.func1(val_int), expected_text="Foo[int]")

    # This should generate an error because the argument type doesn't match.
    FooSub2.func1(val_str)

    reveal_type(Foo.func2(val_str), expected_text="Foo[str]")
    reveal_type(FooSub1.func2(val_str), expected_text="Foo[str]")
    reveal_type(FooSub2.func2(val_int), expected_text="Foo[int]")

    # This should generate an error because the argument type doesn't match.
    FooSub2.func2(val_str)
