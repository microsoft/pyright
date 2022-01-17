# This sample tests the use of unpacked tuples in a Callable, as described
# in PEP 646.

from typing import Callable, Tuple, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack

_T = TypeVar("_T", bound=int)

TA1 = Callable[[_T, Unpack[Tuple[int, ...]], Tuple[int, int, str], str], _T]

# This should generate an error
TA2 = Callable[[int, Unpack[Tuple[int, ...]], Unpack[Tuple[int, int, str]], str], int]

TA3 = Callable[[int, Unpack[Tuple[int, int]], str], int]


def func1(x: TA1):
    r1 = x(3, 4, 5, (1, 2, "hi"), "hi")
    reveal_type(r1, expected_text="int")

    x(3, (1, 2, "hi"), "hi")

    # This should generage an error because the first argument is not an int.
    x(None, (1, 2, "hi"), "hi")

    y = [1, 2, 3]
    x(1, *y, (1, 2, "hi"), "hi")


def func2(x: TA3):
    x(3, 4, 5, "hi")

    # This should generate an error.
    x(3, 4, "hi")

    # This should generate an error.
    x(3, 4, "hi", "hi")


Ts = TypeVarTuple("Ts")


def func3(
    path: str, *args: Unpack[Tuple[Unpack[Ts], str]]
) -> Union[Unpack[Tuple[Unpack[Ts], int]]]:
    ...


v3 = func3("", 1, "2", 3.3, None, "")
reveal_type(v3, expected_text="int | str | float | None")

func3("", "")

# This should generate an error because the type of the first arg is wrong.
func3(1, "")

# This should generate an error because the type of the last arg is wrong.
func3("", 1)

# This should generate an error because the type of the last arg is wrong.
func3("", 1, 2, 3, "hi", 1)


def func4(
    path: str, *args: Unpack[Tuple[Unpack[Ts], str]]
) -> Tuple[Unpack[Ts], complex]:
    ...


v4 = func4("", 1, "2", 3.3, None, "")
reveal_type(v4, expected_text="Tuple[int, str, float, None, complex]")


def func5(path: str, *args: Unpack[Tuple[str, ...]]) -> None:
    ...


# This should generate an errors.
func5("", 1, "2", "")
func5("", "1", "2", "3.3", "None", "")

# This should generate one error.
func5("", "1", "2", "3.3", "None", 3)
