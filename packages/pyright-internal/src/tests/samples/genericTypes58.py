# This sample tests the handling of functions that include TypeVars
# within unions, where the TypeVar may not be matched during constraint
# solving.

from typing import (
    Awaitable,
    Callable,
    Generic,
    List,
    TypeVar,
    Union,
)


_T = TypeVar("_T")


def func1(x: Union[str, None, _T]) -> Union[str, None, _T]:
    ...


reveal_type(func1(None), expected_text="str | None")
reveal_type(func1("hi"), expected_text="str | None")
reveal_type(func1(3), expected_text="str | int | None")


def func2(x: Union[str, None, _T]) -> List[Union[str, None, _T]]:
    ...


reveal_type(func2(None), expected_text="List[str | None]")
reveal_type(func2("hi"), expected_text="List[str | None]")
reveal_type(func2(3), expected_text="List[str | int | None]")


CallbackSig = Callable[..., Awaitable[None]]
CallbackSigT = TypeVar("CallbackSigT", bound="CallbackSig")


class UsesFoo(Generic[CallbackSigT]):
    ...


def dec1() -> Callable[
    [Union[CallbackSigT, UsesFoo[CallbackSigT]]], UsesFoo[CallbackSigT]
]:
    ...


@dec1()
async def bars() -> None:
    ...
