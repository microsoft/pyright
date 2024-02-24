# This sample tests the handling of Unpack[Tuple[...]] as described
# in PEP 646.

from typing import Union
from typing_extensions import Unpack  # pyright: ignore[reportMissingModuleSource]


def func1(v1: tuple[int, Unpack[tuple[bool, bool]], str]):
    reveal_type(v1, expected_text="tuple[int, bool, bool, str]")


def func2(v2: tuple[int, Unpack[tuple[bool, bool]], str, Unpack[tuple[bool, bool]]]):
    reveal_type(v2, expected_text="tuple[int, bool, bool, str, bool, bool]")


def func3(v3: tuple[int, Unpack[tuple[bool, ...]], str]):
    reveal_type(v3, expected_text="tuple[int, *tuple[bool, ...], str]")


# This should generate an error because there are multiple unbounded tuples.
def func4(v4: tuple[Unpack[tuple[bool, ...]], ...]):
    pass


# This should generate an error because there are multiple unbounded tuples.
def func5(v5: tuple[Unpack[tuple[Unpack[tuple[bool, ...]]]], ...]):
    pass


def func6(v6: tuple[Unpack[tuple[bool]]]):
    reveal_type(v6, expected_text="tuple[bool]")


def func7(v7: tuple[Unpack[tuple[bool, Unpack[tuple[int, float]]]]]):
    reveal_type(v7, expected_text="tuple[bool, int, float]")


def func8(v8: tuple[Unpack[tuple[bool, Unpack[tuple[int, ...]]]]]):
    reveal_type(v8, expected_text="tuple[bool, *tuple[int, ...]]")


# This should generate an error because unpack isn't allowed for simple parameters.
def func9(v9: Unpack[tuple[int, int]]):
    pass


# This should generate an error because unpack isn't allowed for **kwargs parameters.
def func10(**v10: Unpack[tuple[int, int]]):
    pass


def func11(*v11: Unpack[tuple[int, ...]]):
    pass


def func12(*v11: Unpack[tuple[int, int]]):
    pass


def func13(t: type):
    if t is Unpack:
        ...


def func14(
    *args: Unpack[tuple[int]],
    other: str,
) -> None: ...


func14(1, other="hi")

# This should generate an error because the second argument
# corresponds to a keyword-only parameter.
func14(1, "hi")
