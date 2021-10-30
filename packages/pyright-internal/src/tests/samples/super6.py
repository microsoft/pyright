# This sample tests the case where super().__new__(cls) is called
# and there is an inferred return type based on the cls type.

from typing import Literal, NamedTuple

FooBase = NamedTuple("FooBase", [("x", int)])


class Foo(FooBase):
    def __new__(cls):
        obj = super().__new__(cls, x=1)
        t1: Literal["Self@Foo"] = reveal_type(obj)
        return obj


f = Foo()
t2: Literal["Foo"] = reveal_type(f)
