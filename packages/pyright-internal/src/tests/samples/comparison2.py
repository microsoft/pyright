# This sample tests the reportUnnecessaryComparison diagnostic check
# when applied to functions that appear within a conditional expression.


from typing import Any, Callable, Coroutine, Protocol
from dataclasses import dataclass


def cond() -> bool: ...


# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
if cond:
    pass

# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
if 0 or cond:
    pass

# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
if 1 and cond:
    pass

if cond():
    pass
# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
elif cond:
    pass


# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
def func1():
    while cond:
        pass


# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
a = [x for x in range(20) if cond]

# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
a = 1 if cond else 2

b = "1" == "1" == "1"

c = ""
# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
if c is None:
    pass

# This should generate a diagnostic when reportUnnecessaryComparison is enabled.
if c is not None:
    pass


def func2(d: str | Any):
    if d is None:
        pass


@dataclass
class DC1:
    bar: str


def func3(x: DC1):
    # This should generate an error if reportUnnecessaryComparison is enabled.
    if x == 42:
        ...


async def func4() -> bool:
    return True


async def func5() -> None:
    # This should generate an error if reportUnnecessaryComparison is enabled.
    if func4():
        pass


def func6() -> Coroutine[Any, Any, int] | None: ...


def func7():
    coro = func6()
    if coro:
        pass


class A: ...


def func8(x: A):
    # This should generate an error if reportUnnecessaryComparison is enabled.
    if x is True:
        pass

    # This should generate an error if reportUnnecessaryComparison is enabled.
    if x is False:
        pass

    # This should generate an error if reportUnnecessaryComparison is enabled.
    if x is not True:
        pass

    # This should generate an error if reportUnnecessaryComparison is enabled.
    if x is not False:
        pass


def func9(x: object, y: type[object]):
    if x is y:
        pass


def func10(x: object, y: type[object]):
    if x is not y:
        pass


class SupportsBool(Protocol):
    def __bool__(self) -> Any: ...


def func11(a: A, b: SupportsBool, c: object):
    # This should generate an error if reportUnnecessaryComparison is enabled.
    if a is None:
        pass

    # This should generate an error if reportUnnecessaryComparison is enabled.
    if a is not None:
        pass

    if b is None:
        pass

    if c is None:
        pass


def func12(a: object, b: Callable[..., int]) -> bool:
    return a is b
