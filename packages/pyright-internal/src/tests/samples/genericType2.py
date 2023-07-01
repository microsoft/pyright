# This sample tests the type checker's ability to do bidirectional
# type inference when the expected type is defined by a bound TypeVar.

from typing import TypeVar


class A:
    pass


class B(A):
    pass


class C(A):
    pass


_T_A = TypeVar("_T_A", bound=A)


def func1(value: dict[str, _T_A]) -> _T_A:
    return value["a"]


x = func1({"b": B(), "c": C()})
reveal_type(x, expected_text="B | C")
