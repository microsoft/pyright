# This sample tests the handling of functions that include TypeVars
# within unions, where the TypeVar may not be matched during constraint
# solving.

from typing import (
    Awaitable,
    Callable,
    Generic,
    List,
    Literal,
    TypeVar,
    Union,
)


_T = TypeVar("_T")


def func1(x: Union[str, None, _T]) -> Union[str, None, _T]:
    ...


t1_1: Literal["str | None"] = reveal_type(func1(None))
t1_2: Literal["str | None"] = reveal_type(func1("hi"))
t1_3: Literal["str | int | None"] = reveal_type(func1(3))


def func2(x: Union[str, None, _T]) -> List[Union[str, None, _T]]:
    ...


t2_1: Literal["List[str | None]"] = reveal_type(func2(None))
t2_2: Literal["List[str | None]"] = reveal_type(func2("hi"))
t2_3: Literal["List[str | int | None]"] = reveal_type(func2(3))


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
