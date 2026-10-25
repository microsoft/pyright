# This sample tests the handling of a TypeVar whose upper bound is
# a tuple when used for an *args parameter or unpacked in a tuple.

from typing import TypeVar, Unpack


T = TypeVar("T", bound="tuple[int, ...]")


def func1(*args: Unpack[T]) -> tuple[int, ...]:
    a, *v = args

    reveal_type(a, expected_text="int")

    b: int = a

    # This should generate an error.
    c: str = a

    reveal_type(v, expected_text="list[int]")

    return args


S = TypeVar("S", bound=list[int])


# This should generate an error.
def func2(*args: Unpack[S]) -> int:
    return 0


U = TypeVar("U", bound=tuple[int, str])


def func3(t: tuple[bytes, *U]):
    a, b, c = t
    reveal_type(a, expected_text="bytes")
    reveal_type(b, expected_text="int")
    reveal_type(c, expected_text="str")

    reveal_type(t[1], expected_text="int")
    reveal_type(t[-1], expected_text="str")

    match t:
        case (x, y, z):
            reveal_type(y, expected_text="int")
            reveal_type(z, expected_text="str")


def func4(t: tuple[bytes, *U]):
    # This should generate an error.
    a, b = t

    # This should generate an error.
    a, b, c, d = t

    # This should generate an error.
    v1 = t[3]

    # This should generate an error.
    v2 = t[-4]


V = TypeVar("V", bound=tuple[object, ...])


def func5(t: tuple[int, *V, int]):
    [a, *b, c] = t
    reveal_type(a, expected_text="int")
    reveal_type(b, expected_text="list[object]")
    reveal_type(c, expected_text="int")

    reveal_type(t[-1], expected_text="int")
    reveal_type(t[1:], expected_text="tuple[*V@func5, int]")
    reveal_type(t[2:], expected_text="tuple[int | object, ...]")

    match t:
        case (x, *y, z):
            reveal_type(y, expected_text="list[object]")


def func6(t: tuple[int, *V, int]):
    # This should generate an error.
    [a] = t
