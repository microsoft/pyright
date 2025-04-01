# This sample tests the case where a TypeVarTuple is solved using
# a tuple with literal values.

# Enable experimental features to support Union[*Ts].
# pyright: enableExperimentalFeatures=true

from typing import Callable, Literal, TypeVarTuple, Union, Unpack

Ts = TypeVarTuple("Ts")


def func1(
    f: Callable[[Unpack[Ts]], None], vs: tuple[Unpack[Ts]]
) -> Union[Unpack[Ts]]: ...


def func2(f: Callable[[Literal[1, 2]], None], vs: tuple[Literal[1, 2]]):
    v1 = func1(f, vs)
    reveal_type(v1, expected_text="Literal[1, 2]")


def func3(f: Callable[[Literal[1, 2, 3]], None], vs: tuple[Literal[1, 2]]):
    v1 = func1(f, vs)
    reveal_type(v1, expected_text="Literal[1, 2]")


def func4(f: Callable[[int], None], vs: tuple[Literal[1, 2]]):
    v1 = func1(f, vs)
    reveal_type(v1, expected_text="int")


def func5(f: Callable[[Literal[1, 2]], None], vs: tuple[Literal[1, 2, 3]]):
    # This should result in an error.
    func1(f, vs)


def func6(f: Callable[[Literal[1, 2]], None], vs: tuple[int]):
    # This should result in an error.
    func1(f, vs)


def func7(f: Callable[[int, int, int], None], vs: tuple[int, ...]):
    # This should result in an error because of a size mismatch.
    func1(f, vs)


def func8(f: Callable[[Unpack[tuple[int, ...]]], None], vs: tuple[int]):
    v1 = func1(f, vs)
    reveal_type(v1, expected_text="int")
