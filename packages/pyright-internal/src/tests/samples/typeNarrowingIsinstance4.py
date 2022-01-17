# This sample checks the handling of callable types that are narrowed
# to a particular type using an isinstance type narrowing test.

from typing import Callable, Protocol, Union, runtime_checkable


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
        reveal_type(val, expected_text="Foo")
    else:
        # This doesn't get narrowed because `Foo` is not a runtime checkable protocol.
        reveal_type(val, expected_text="((int, str) -> None) | ((int) -> None)")


def check_callable2(val: Union[Callable[[int, str], None], Callable[[int], None]]):
    if isinstance(val, Bar):
        reveal_type(val, expected_text="Bar")
    else:
        reveal_type(val, expected_text="(int, str) -> None")


def check_callable3(val: Union[Callable[[int, str], None], Callable[[int], None]]):
    if isinstance(val, Baz):
        reveal_type(val, expected_text="Never")
    else:
        reveal_type(val, expected_text="((int, str) -> None) | ((int) -> None)")


def check_callable4(val: Union[type, Callable[[int], None]]):
    if isinstance(val, type):
        reveal_type(val, expected_text="type")
    else:
        reveal_type(val, expected_text="(int) -> None")
