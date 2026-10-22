# This sample tests the reportImplicitOverride diagnostic check
# (strict enforcement of PEP 698).

from typing import Any, Callable, Protocol, overload
from typing_extensions import override  # pyright: ignore[reportMissingModuleSource]


def evil_wrapper(func: Callable[..., Any], /):
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError

    return wrapped


class Base:
    @override
    def __init__(self):
        pass

    def method1(self):
        pass

    @property
    def prop_c(self) -> int:
        return 0

    def method2(self):
        pass


class Child(Base):
    def __init__(self):
        pass

    # This should generate an error if reportImplicitOverride is enabled.
    def method1(self):
        pass

    @property
    # This should generate an error if reportImplicitOverride is enabled.
    def prop_c(self) -> int:
        return 0

    @evil_wrapper
    def method2(self):
        pass


class BaseProto(Protocol):
    def method3(self, x: int, /) -> int: ...

    def method4(self, x: int, /) -> int: ...


class ChildProto(BaseProto, Protocol):
    @overload
    # This should generate an error if reportImplicitOverride is enabled.
    def method3(self, x: int, /) -> int: ...

    @overload
    def method3(self, x: str, /) -> str: ...

    @override
    @overload
    def method4(self, x: int, /) -> int: ...

    @overload
    def method4(self, x: str, /) -> str: ...
