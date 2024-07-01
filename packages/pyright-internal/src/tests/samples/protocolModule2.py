# This sample tests protocol matching for modules.

from typing import Protocol, TypeVar, runtime_checkable
from . import protocolModule1
import datetime
from importlib import import_module


@runtime_checkable
class P1(Protocol):
    var_1: int
    var_2: int | str

    def func_1(self, a: int, b: str) -> str: ...

    @staticmethod
    def func_2() -> str: ...


v1: P1 = protocolModule1


@runtime_checkable
class P2(Protocol):
    var_1: str


# This should generate an error because var_1 has the
# wrong type.
v2: P2 = protocolModule1


class P3(Protocol):
    def func_1(self, a: int, b: str) -> int: ...


# This should generate an error because func_1 has the
# wrong type.
v3: P3 = protocolModule1


class P4(Protocol):
    def func_2(self) -> str: ...

    y: int


# This should generate an error because y is missing.
v4: P4 = protocolModule1


_T = TypeVar("_T", bound=P2)


class NonProtocol: ...


# Test type narrowing of module symbols for isinstance checks.
def func1(x: type[_T]):
    if isinstance(datetime, (P1, P2, NonProtocol, x)):
        reveal_type(datetime, expected_text="P1 | P2 | _T@func1")
    else:
        reveal_type(datetime, expected_text='Module("datetime")')


def func2():
    if not isinstance(datetime, P1):
        reveal_type(datetime, expected_text='Module("datetime")')
    else:
        reveal_type(datetime, expected_text="P1")


def func3():
    my_module = import_module("my_module")
    if isinstance(my_module, (P1, NonProtocol)):
        reveal_type(my_module, expected_text="P1")
    else:
        reveal_type(my_module, expected_text="ModuleType")


_T1 = TypeVar("_T1")


class P5(Protocol[_T1]):
    def func_1(self, a: int, b: _T1) -> _T1: ...


def func4(x: P5[_T1]) -> _T1: ...


v5 = func4(protocolModule1)
reveal_type(v5, expected_text="str")


class P6(Protocol):
    @property
    def var_1(self) -> int: ...


v6: P6 = protocolModule1
