# This sample tests the type checker's validation
# of the __init_subclass__ method described in
# PEP 487.

from datetime import datetime
from typing import Any, Optional, Type


class Foo:
    def __init_subclass__(
        cls, *, param1: str, param2: float, param3: Optional[Any] = None
    ) -> None:
        super().__init_subclass__()


# This should generate an error because param1 is
# the wrong type.
class Bar1(Foo, param1=0, param2=4):
    pass


# This should generate an error because param2 is missing.
class Bar2(Foo, param1="0", param3=datetime.now()):
    pass


class Bar3(Foo, param1="0", param2=5.0):
    pass


class Bar4:
    def __init_subclass__(cls, *, arg: int) -> None:
        func(cls, arg)

    def __new__(cls) -> "Bar4":
        func(cls, 9)
        return super().__new__(cls)


def func(klass: Type[Bar4], arg: int):
    pass
