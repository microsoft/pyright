# This sample tests the handling of isinstance and issubclass type
# narrowing in the case where there is no overlap between the
# value type and the test type.

from typing import Literal, Type, TypeVar


class A:
    a_val: int


class B:
    b_val: int


class C:
    c_val: int


def func1(val: A):
    if isinstance(val, B):
        val.a_val
        val.b_val

        # This should generate an error
        val.c_val

        t1: Literal["<subclass of A and B>"] = reveal_type(val)

        if isinstance(val, C):
            val.a_val
            val.b_val
            val.c_val
            t2: Literal["<subclass of <subclass of A and B> and C>"] = reveal_type(val)

    else:
        val.a_val

        # This should generate an error
        val.b_val

        t3: Literal["A"] = reveal_type(val)


def func2(val: Type[A]):
    if issubclass(val, B):
        val.a_val
        val.b_val

        # This should generate an error
        val.c_val

        t1: Literal["Type[<subclass of A and B>]"] = reveal_type(val)

        if issubclass(val, C):
            val.a_val
            val.b_val
            val.c_val
            t2: Literal[
                "Type[<subclass of <subclass of A and B> and C>]"
            ] = reveal_type(val)

    else:
        val.a_val

        # This should generate an error
        val.b_val

        t3: Literal["Type[A]"] = reveal_type(val)


_T1 = TypeVar("_T1", bound=A)


def func3(val: _T1) -> _T1:
    if isinstance(val, B):
        return val
    return val
