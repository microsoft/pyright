# This sample checks the handling of callable types that are narrowed
# to a particular type using an isinstance type narrowing test.

from typing import Callable, Literal, Protocol, Union, runtime_checkable


class Foo:
    def __call__(self, arg: int, bar: str) -> None:
        raise NotImplementedError


@runtime_checkable
class Bar(Protocol):
    def __call__(self, arg: int) -> None:
        raise NotImplementedError


@runtime_checkable
class Baz(Protocol):
    def __call__(self, arg: str) -> None:
        raise NotImplementedError


def check_callable1(val: Union[Callable[[int, str], None], Callable[[int], None]]):
    if isinstance(val, Foo):
        t1: Literal["Foo"] = reveal_type(val)
    else:
        # This doesn't get narrowed because `Foo` is not a runtime checkable protocol.
        t2: Literal["((int, str) -> None) | ((int) -> None)"] = reveal_type(val)


def check_callable2(val: Union[Callable[[int, str], None], Callable[[int], None]]):
    if isinstance(val, Bar):
        t1: Literal["Bar"] = reveal_type(val)
    else:
        t2: Literal["(int, str) -> None"] = reveal_type(val)


def check_callable3(val: Union[Callable[[int, str], None], Callable[[int], None]]):
    if isinstance(val, Baz):
        t1: Literal["Never"] = reveal_type(val)
    else:
        t2: Literal["((int, str) -> None) | ((int) -> None)"] = reveal_type(val)


def check_callable4(val: Union[type, Callable[[int], None]]):
    if isinstance(val, type):
        t1: Literal["type"] = reveal_type(val)
    else:
        t2: Literal["(int) -> None"] = reveal_type(val)
