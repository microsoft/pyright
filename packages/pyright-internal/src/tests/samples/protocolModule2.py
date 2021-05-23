# This sample tests protocol matching for modules.

from typing import Literal, Protocol, Type, TypeVar, Union, runtime_checkable
from . import protocolModule1
import datetime
from importlib import import_module


@runtime_checkable
class P1(Protocol):
    var_1: int
    var_2: Union[int, str]

    def func_1(self, a: int, b: str) -> str:
        ...

    @staticmethod
    def func_2() -> str:
        ...


v1: P1 = protocolModule1


@runtime_checkable
class P2(Protocol):
    var_1: str


# This should generate an error because var_1 has the
# wrong type.
v2: P2 = protocolModule1


class P3(Protocol):
    def func_1(self, a: int, b: str) -> int:
        ...


# This should generate an error because func_1 has the
# wrong type.
v3: P3 = protocolModule1


class P4(Protocol):
    def func_2(self) -> str:
        ...

    y: int


# This should generate an error because y is missing.
v4: P4 = protocolModule1


_T = TypeVar("_T", bound=P2)


class NonProtocol:
    ...


# Test type narrowing of module symbols for isinstance checks.
def func1(x: Type[_T]):
    if isinstance(datetime, (P1, P2, NonProtocol, x)):
        t1: Literal["P1 | P2 | _T@func1"] = reveal_type(datetime)
    else:
        t2: Literal['Module("datetime")'] = reveal_type(datetime)


def func2():
    if not isinstance(datetime, P1):
        t1: Literal['Module("datetime")'] = reveal_type(datetime)
    else:
        t2: Literal["P1"] = reveal_type(datetime)


def func3():
    my_module = import_module("my_module")
    if isinstance(my_module, (P1, NonProtocol)):
        t1: Literal["P1"] = reveal_type(my_module)
    else:
        t2: Literal["ModuleType"] = reveal_type(my_module)
