# This sample tests the case where a property is defined on a metaclass.

from typing import Literal


class MyMeta(type):
    @property
    def something(cls) -> "Base":
        return Base(1234)


class Base(metaclass=MyMeta):
    def __new__(cls, arg) -> "Base":
        ...


t1: Literal["Base"] = reveal_type(Base.something)
