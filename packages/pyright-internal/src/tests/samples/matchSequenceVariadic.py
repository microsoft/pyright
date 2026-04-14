# This sample tests pattern matching with variadic tuple types.
# From the regression report for Pyright 1.1.408.

from typing import TypeAlias, assert_type

Func6Input: TypeAlias = tuple[int] | tuple[str, str] | tuple[int, *tuple[str, ...], int]


def func6(val: Func6Input):
    match val:
        case (x,):
            # Type may be narrowed to tuple[int].
            # E: Argument of type "tuple[int]" cannot be assigned to parameter of type "tuple[int] | tuple[str, str] | tuple[int, *tuple[str, ...], int]"
            assert_type(val, Func6Input)
            assert_type(val, tuple[int])

        case (x, y):
            # Type may be narrowed to tuple[str, str] | tuple[int, int].
            # E: Argument of type "tuple[str, str] | tuple[int, int]" cannot be assigned to parameter of type "tuple[int] | tuple[str, str] | tuple[int, *tuple[str, ...], int]"
            assert_type(val, Func6Input)
            assert_type(val, tuple[str, str] | tuple[int, int])

        case (x, y, z):
            # Type may be narrowed to tuple[int, str, int].
            # This case should be reachable!
            # E: Argument of type "tuple[int, str, int]" cannot be assigned to parameter of type "tuple[int] | tuple[str, str] | tuple[int, *tuple[str, ...], int]"
            assert_type(val, Func6Input)
            assert_type(val, tuple[int, str, int])

        case (w, x, y, z):
            # Type may be narrowed to tuple[int, str, str, int].
            # E: Argument of type "tuple[int, str, str, int]" cannot be assigned to parameter of type "tuple[int] | tuple[str, str] | tuple[int, *tuple[str, ...], int]"
            assert_type(val, Func6Input)
            assert_type(val, tuple[int, str, str, int])
