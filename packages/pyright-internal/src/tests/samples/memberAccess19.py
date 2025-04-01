# This sample tests the handling of __getattr__, __setattr__, and
# __delattr__ methods.

from typing import Any, Literal, TypeVar, overload

T = TypeVar("T")


class A:
    @overload
    def __getattr__(self, key: Literal["a"]) -> Literal["x"]: ...

    @overload
    def __getattr__(self, key: Literal["b"]) -> Literal[4]: ...

    @overload
    def __getattr__(self, key: Literal["c"]) -> Literal["y"]: ...

    @overload
    def __getattr__(self: T, key: Literal["d"]) -> T: ...

    def __getattr__(self, key: Literal["a", "b", "c", "d"]) -> Any: ...

    @overload
    def __setattr__(self, key: Literal["e"], val: str): ...

    @overload
    def __setattr__(self, key: Literal["f"], val: int): ...

    def __setattr__(self, key: str, val: str | int):
        pass

    @overload
    def __delattr__(self, key: Literal["g"]): ...

    @overload
    def __delattr__(self, key: Literal["h"]): ...

    def __delattr__(self, key: str):
        pass


a = A()

reveal_type(a.a, expected_text="Literal['x']")
reveal_type(a.b, expected_text="Literal[4]")
reveal_type(a.c, expected_text="Literal['y']")
reveal_type(a.d, expected_text="A")

# This should generate an error.
reveal_type(a.e)

# This should generate an error.
a.a = 4

a.e = "4"

# This should generate an error.
a.e = 4

# This should generate an error.
a.f = "4"

a.f = 4

# This should generate an error.
del a.e

del a.g

del a.h


# Test asymmetric __getattr__ and __setattr__ methods. We should not
# narrow the type on assignment in this case.
class B:
    def __setattr__(self, __name: str, __value: Any) -> None:
        pass

    def __getattr__(self, __attr: str) -> int:
        return 10


a = B()
a.test = "anything"
reveal_type(a.test, expected_text="int")
