# This sample tests the handling of TypeVar defaults with isinstance type
# narrowing.

from typing import Any, Generic, ParamSpec, TypeVar


P = ParamSpec("P", default=...)
R = TypeVar("R", default=Any)


class ParentA(Generic[P, R]): ...


class ChildA(ParentA[P, R]):
    pass


def func(x: ParentA[[int], int]):
    if isinstance(x, ChildA):
        reveal_type(x, expected_text="ChildA[(int), int]")
    else:
        reveal_type(x, expected_text="ParentA[(int), int]")
