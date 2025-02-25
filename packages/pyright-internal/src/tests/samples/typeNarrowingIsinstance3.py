# This sample tests the handling of isinstance and issubclass type
# narrowing in the case where there is no overlap between the
# value type and the test type.

from typing import TypeVar, final


class A:
    a_val: int


class B:
    b_val: int


class C:
    c_val: int


@final
class D:
    d_val: int


def func1(val: A):
    if isinstance(val, B):
        val.a_val
        val.b_val

        # This should generate an error
        val.c_val

        reveal_type(val, expected_text="<subclass of A and B>")

        if isinstance(val, C):
            val.a_val
            val.b_val
            val.c_val
            reveal_type(val, expected_text="<subclass of <subclass of A and B> and C>")

    else:
        val.a_val

        # This should generate an error
        val.b_val

        reveal_type(val, expected_text="A")


def func2(val: type[A]):
    if issubclass(val, B):
        val.a_val
        val.b_val

        # This should generate an error
        val.c_val

        reveal_type(val, expected_text="type[<subclass of A and B>]")

        if issubclass(val, C):
            val.a_val
            val.b_val
            val.c_val
            reveal_type(
                val, expected_text="type[<subclass of <subclass of A and B> and C>]"
            )

    else:
        val.a_val

        # This should generate an error
        val.b_val

        reveal_type(val, expected_text="type[A]")


_T1 = TypeVar("_T1", bound=A)


def func3(val: _T1) -> _T1:
    if isinstance(val, B):
        return val
    return val


def func4(val: D):
    if isinstance(val, A):
        reveal_type(val, expected_text="Never")


def func5(val: type[int]):
    if isinstance(val, str):
        x: type = val
