# This sample tests the case where a __getattr__ method override
# differentiates based on the name of the accessed member.

from typing import Any, overload, Literal


class Obj:
    @overload
    def __getattr__(self, name: Literal["foo"]) -> int: ...

    @overload
    def __getattr__(self, name: Literal["bar"]) -> str: ...

    def __getattr__(self, name: str) -> Any:
        if name == "foo":
            return 1
        return "1"

    def __setattr__(self, name: str, value: str) -> None:
        pass


obj = Obj()
b1 = obj.foo
reveal_type(b1, expected_text="int")
b2 = getattr(obj, "foo")
reveal_type(b2, expected_text="Any")

c1 = obj.bar
reveal_type(c1, expected_text="str")
c2 = getattr(obj, "bar")
reveal_type(c2, expected_text="Any")

# This should generate two errors.
d1 = obj.bogus

obj.foo = ""
obj.bar = ""

# This should generate an error.
obj.foo = 1

# This should generate an error.
obj.other = 1

# This should generate an error.
del obj.foo
