# This sample tests the case where a __getattr__ method override
# differentiates based on the name of the accessed member.

from typing import Any, overload, Literal


class Obj:
    @overload
    def __getattr__(self, name: Literal["foo"]) -> int:
        ...

    @overload
    def __getattr__(self, name: Literal["bar"]) -> str:
        ...

    def __getattr__(self, name: str) -> Any:
        if name == "foo":
            return 1
        return "1"


obj = Obj()
b1 = obj.foo
t_b1: Literal["int"] = reveal_type(b1)
b2 = getattr(obj, "foo")
t_b2: Literal["Any"] = reveal_type(b2)

c1 = obj.bar
t_c1: Literal["str"] = reveal_type(c1)
c2 = getattr(obj, "bar")
t_c2: Literal["Any"] = reveal_type(c2)
