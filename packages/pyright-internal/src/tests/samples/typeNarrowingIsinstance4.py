# This sample checks the handling of callable types that are narrowed
# to a particular type using an isinstance type narrowing test.

from typing import Callable, ParamSpec, Protocol, Union, runtime_checkable

P = ParamSpec("P")


class ClassA:
    def __call__(self, arg: int, bar: str) -> None:
        raise NotImplementedError


@runtime_checkable
class ClassB(Protocol):
    def __call__(self, arg: int) -> None:
        raise NotImplementedError


@runtime_checkable
class ClassC(Protocol):
    def __call__(self, arg: str) -> None:
        raise NotImplementedError


def check_callable1(val: Union[Callable[[int, str], None], Callable[[int], None]]):
    if isinstance(val, ClassA):
        reveal_type(val, expected_text="ClassA")
    else:
        # This doesn't get narrowed because `ClassA` is not a runtime checkable protocol.
        reveal_type(val, expected_text="((int, str) -> None) | ((int) -> None)")


def check_callable2(val: Union[Callable[[int, str], None], Callable[[int], None]]):
    if isinstance(val, ClassB):
        reveal_type(val, expected_text="((int, str) -> None) | ((int) -> None)")
    else:
        reveal_type(val, expected_text="Never")


def check_callable3(val: Union[Callable[[int, str], None], Callable[[int], None]]):
    if isinstance(val, ClassC):
        reveal_type(val, expected_text="((int, str) -> None) | ((int) -> None)")
    else:
        reveal_type(val, expected_text="Never")


def check_callable4(val: Union[type, Callable[[int], None]]):
    if isinstance(val, type):
        reveal_type(val, expected_text="type")
    else:
        reveal_type(val, expected_text="(int) -> None")


def check_callable5(fn: Callable[P, None]) -> None:
    if isinstance(fn, ClassA):
        reveal_type(fn, expected_text="ClassA")
    else:
        reveal_type(fn, expected_text="(**P@check_callable5) -> None")


def check_callable6(o: object | Callable[[int], int]):
    if isinstance(o, Callable):
        reveal_type(o, expected_text="((...) -> Unknown) | ((int) -> int)")
    else:
        reveal_type(o, expected_text="object")
