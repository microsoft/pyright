# This sample verifies that the type checker doesn't use the
# final function that omits the @overload decorator when matching
# a caller against an overloaded function.

from typing import Union, TypeVar, overload, Tuple, Optional

T = TypeVar("T")


@overload
def mouse_event(x1: int, y1: int) -> int:
    ...


@overload
def mouse_event(x1: int, y1: int, x2: int, y2: int) -> Tuple[int, int]:
    ...


def mouse_event(
    x1: int, y1: int, x2: Optional[int] = None, y2: Optional[int] = None
) -> Union[int, Tuple[int, int]]:
    return 1


# This should generate an error because it doesn't match either
# of the @overload versions, even though it does match the
# version of the function that omits the @overload.
t = mouse_event(1, 2, 3)
