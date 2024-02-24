# This sample tests the handling of the @override decorator as described
# in PEP 698.

from typing import Callable
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Any,
    overload,
    override,
)


class ClassA:
    def method1(self) -> None:
        pass


class ClassB:
    def method3(self) -> None:
        pass

    @overload
    def method5(self, x: int) -> int: ...

    @overload
    def method5(self, x: str) -> str: ...

    def method5(self, x: int | str) -> int | str: ...


class ClassC(ClassA, ClassB):
    @property
    @override
    # This should generate an error because prop_a doesn't
    # override anything in its base class.
    def prop_a(self) -> int:
        raise NotImplementedError

    @override
    def method1(self) -> None:
        pass

    def method2(self) -> None:
        pass

    @override
    def method3(self) -> None:
        pass

    @override
    # This should generate an error because method3 does not
    # override anything in a base class.
    def method4(self) -> None:
        pass

    @overload
    def method5(self, x: int) -> int: ...

    @overload
    def method5(self, x: str) -> str: ...

    @override
    def method5(self, x: int | str) -> int | str: ...

    @overload
    def method6(self, x: int) -> int: ...

    @overload
    def method6(self, x: str) -> str: ...

    @override
    # This should generate an error because method6 does not
    # override anything in a base class.
    def method6(self, x: int | str) -> int | str: ...


class ClassD(Any): ...


class ClassE(ClassD):
    @override
    def method1(self) -> None:
        pass


def evil_wrapper(func: Callable[..., Any], /):
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError

    return wrapped


class F:
    def method1(self):
        pass


class G(F):
    @override
    @evil_wrapper
    def method1(self):
        pass
