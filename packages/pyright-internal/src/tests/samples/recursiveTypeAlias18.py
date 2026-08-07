# This sample tests that the type arguments of a specialized generic
# recursive type alias are retained when the type is printed.

from typing import TypeAlias, TypeVar


type Alias1[T] = tuple[T, Alias1[T] | None]


def func1(x: Alias1[str]):
    reveal_type(x, expected_text="tuple[str, Alias1[str] | None]")
    reveal_type(x[0], expected_text="str")
    reveal_type(x[1], expected_text="Alias1[str] | None")


S = TypeVar("S")
Alias2: TypeAlias = "tuple[S, Alias2[S] | None]"


def func2(x: Alias2[int]):
    reveal_type(x, expected_text="tuple[int, Alias2[int] | None]")
    reveal_type(x[1], expected_text="Alias2[int] | None")


type Alias3[T] = list[T | Alias3[T]]


def func3(x: Alias3[str]):
    reveal_type(x, expected_text="list[str | Alias3[str]]")
    reveal_type(x[0], expected_text="str | Alias3[str]")


type Alias4[T, S] = tuple[T, S, Alias4[S, T] | None]


def func4(x: Alias4[int, str]):
    reveal_type(x, expected_text="tuple[int, str, Alias4[str, int] | None]")
    reveal_type(x[2], expected_text="Alias4[str, int] | None")


# The recursive reference is specialized with a type that is itself
# derived from the alias's type parameter.
type Alias5[T] = list[Alias5[list[T]]] | T


def func5(x: Alias5[int]):
    reveal_type(x, expected_text="list[Alias5[list[int]]] | int")


type Alias6[*Ts] = tuple[*Ts, Alias6[*Ts] | None]


def func6(x: Alias6[int, str]):
    reveal_type(x, expected_text="tuple[int, str, Alias6[int, str] | None]")


# An unspecialized reference to a generic recursive type alias
# implicitly uses Unknown type arguments.
def func7(x: Alias1):
    reveal_type(x, expected_text="tuple[Unknown, Alias1[Unknown] | None]")


# A non-generic recursive type alias continues to print using its
# (unparameterized) name.
type Alias8 = int | list[Alias8]


def func8(x: Alias8):
    reveal_type(x, expected_text="int | list[Alias8]")


# The specialization is also reflected in diagnostic messages.
def func9(x: Alias1[int]): ...


def func10(x: Alias1[str]):
    # This should generate an error because Alias1[str] is not
    # assignable to Alias1[int].
    func9(x)

    # This should generate an error because Alias1[str] | None is not
    # assignable to Alias1[int].
    func9(x[1])
