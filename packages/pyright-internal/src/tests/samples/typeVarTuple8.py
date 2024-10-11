# This sample tests variadic TypeVar matching for unions.

# Enable experimental features to support Union[*Ts].
# pyright: enableExperimentalFeatures=true

from typing import TypeVar, Union
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    TypeVarTuple,
    Unpack,
)


_T = TypeVar("_T")
_Xs = TypeVarTuple("_Xs")
_Ys = TypeVarTuple("_Ys")


def func1(x: Union[Unpack[_Xs]]) -> Union[Unpack[_Xs]]: ...


def func2(x: Union[Unpack[_Xs], Unpack[_Ys]]) -> Union[Unpack[_Xs], Unpack[_Ys]]: ...


def func3(x: Union[int, Unpack[_Xs]]) -> Union[Unpack[_Xs]]: ...


def func4(x: Union[_T, Unpack[_Xs]]) -> Union[_T, Unpack[_Xs]]: ...


def func5(x: Union[Unpack[_Xs]], *args: Unpack[_Xs]) -> Union[Unpack[_Xs]]: ...


def func6(*args: Unpack[_Xs]) -> Union[Unpack[_Xs]]: ...


def func7(a: list[Union[Unpack[_Xs]]]) -> Union[Unpack[_Xs]]: ...


def test1(a: int, b: str, c: list[int], d: Union[complex, str]):
    v1_1 = func1(a)
    reveal_type(v1_1, expected_text="int")

    v1_2 = func1(d)
    reveal_type(v1_2, expected_text="complex | str")

    # ---------

    # This behavior isn't defined by PEP 646, but neither
    # did PEP 484 define the behavior for multiple (non-
    # variadic) TypeVar matching within a Union. So behavior
    # is likely to vary between type checkers here.
    v2_1 = func2(a)
    reveal_type(v2_1, expected_text="int")

    v2_2 = func2(d)
    reveal_type(v2_2, expected_text="complex | str")

    # ---------

    v3_1 = func3(a)
    reveal_type(v3_1, expected_text="Unknown")

    # This should generate an error
    v3_2 = func3(d)

    v3_3 = func3(b)
    reveal_type(v3_3, expected_text="str")

    # ---------

    # This behavior isn't defined by PEP 646 or PEP 484.
    v4_1 = func4(a)
    reveal_type(v4_1, expected_text="int")

    v4_2 = func4(d)
    reveal_type(v4_2, expected_text="complex | str")

    # ---------

    v5_1 = func5(a)
    reveal_type(v5_1, expected_text="int")

    v5_2 = func5(a, a)
    reveal_type(v5_2, expected_text="int")

    # This should generate an error
    v5_3 = func5(a, b)

    # This should generate an error
    v5_4 = func5(a, b, c)

    # ---------

    v6_1 = func6(a)
    reveal_type(v6_1, expected_text="int")

    v6_2 = func6(a, b)
    reveal_type(v6_2, expected_text="int | str")

    v6_3 = func6(a, b, d)
    reveal_type(v6_3, expected_text="int | str | complex")

    v6_4 = func6()
    reveal_type(v6_4, expected_text="Never")

    # ---------

    v7_1 = func7([a])
    reveal_type(v7_1, expected_text="int")

    x: list[Union[int, str]] = [a, b]
    v7_2 = func7(x)
    reveal_type(v7_2, expected_text="int | str")

    v7_3 = func7([a, b, d])
    reveal_type(v7_3, expected_text="int | str | complex")
