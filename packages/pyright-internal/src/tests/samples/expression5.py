# This sample tests the validation of binary operations, especially
# in cases where one or both operands are union types and some combination
# of the types is not supported.

from typing import Optional, Union


def arith(
    v1: Union[str, int],
    v2: Optional[Union[str, int]],
    v3: str,
    v4: int,
    v5: Optional[int],
):
    # This should generate an error.
    a1 = v1 + v2

    # This should generate an error
    a2 = 3 + v2

    # This should generate an error
    a3 = 3 + v3

    # This should generate an error
    a4 = 3 + None

    a5 = 3 + v4

    a6 = "hi" + v3

    # This should generate an error
    a7 = "hi" + v4

    # This should generate an error
    a8 = 3 + v5

    assert v5 is not None
    a8 = 3 + v5


def comparison(
    v1: Union[str, int],
    v2: Optional[Union[str, int]],
    v3: str,
    v4: int,
    v5: Optional[int],
):
    # This should generate an error.
    a1 = v1 < v2

    # This should generate an error
    a2 = 3 > v2

    a3 = 3 <= v3

    # This should generate an error
    a4 = 3 >= None

    a5 = 3 < v4

    a6 = "hi" < v3

    # This should generate an error
    a7 = "hi" < v4

    # This should generate an error
    a8 = 3 < v5

    assert v5 is not None
    a8 = 3 < v5
