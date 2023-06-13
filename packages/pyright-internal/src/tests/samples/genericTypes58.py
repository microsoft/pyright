# This sample tests the handling of functions that include TypeVars
# within unions, where the TypeVar may not be solved during constraint
# solving.

from typing import Awaitable, Callable, Generic, ParamSpec, TypeVar


_T = TypeVar("_T")
_P = ParamSpec("_P")


def func1(x: str | None | _T) -> str | None | _T:
    ...


reveal_type(func1(None), expected_text="str | None")
reveal_type(func1("hi"), expected_text="str | None")
reveal_type(func1(3), expected_text="str | int | None")


def func2(x: str | None | _T) -> list[str | None | _T]:
    ...


reveal_type(func2(None), expected_text="list[str | None]")
reveal_type(func2("hi"), expected_text="list[str | None]")
reveal_type(func2(3), expected_text="list[str | int | None]")


Callback = Callable[..., Awaitable[None]]
_C = TypeVar("_C", bound=Callback)


class UsesFoo(Generic[_C]):
    ...


def decorator1() -> Callable[[_C | UsesFoo[_C]], UsesFoo[_C]]:
    ...


@decorator1()
async def func3() -> None:
    ...


def func4(l: list):
    return next(iter(l), None)


val = func4([])
reveal_type(val, expected_text="Unknown | None")


def func5() -> Callable[[Callable[_P, _T]], Callable[_P, _T]]:
    ...


def func6(x: int) -> str:
    ...


reveal_type(func5()(func6), expected_text="(x: int) -> str")
