# This sample tests the case where a function parameterized with
# a TypeVarTuple is called in a nested manner.

from typing import Callable, TypeVar, TypeVarTuple


def f(a: str, b: int, c: bool) -> None: ...


def curry1[First, *Rest, Result](
    function: Callable[[First, *Rest], Result],
) -> Callable[[*Rest], Callable[[First], Result]]: ...


applied_twice1 = curry1(curry1(f))
reveal_type(applied_twice1, expected_text="(bool) -> ((int) -> ((str) -> None))")


First = TypeVar("First")
Rest = TypeVarTuple("Rest")
Result = TypeVar("Result")


def curry2(
    function: Callable[[First, *Rest], Result],
) -> Callable[[*Rest], Callable[[First], Result]]: ...


applied_twice2 = curry2(curry2(f))
reveal_type(applied_twice2, expected_text="(bool) -> ((int) -> ((str) -> None))")
