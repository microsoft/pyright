# This sample tests protocol matching for modules.

from typing import Protocol, Union
from . import protocolModule1


class P1(Protocol):
    var_1: int
    var_2: Union[int, str]

    def func_1(self, a: int, b: str) -> str:
        ...

    @staticmethod
    def func_2() -> str:
        ...


v1: P1 = protocolModule1


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
