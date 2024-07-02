# This sample tests the case where a method is overriding an overloaded method.

from typing import Any, Generic, Literal, TypeVar, overload

_T = TypeVar("_T")


class Parent1(Generic[_T]):
    @overload
    def m1(self, x: Literal[True]) -> int: ...

    @overload
    def m1(self, x: Literal[False]) -> float: ...

    @overload
    def m1(self, x: _T) -> _T: ...

    def m1(self, x: bool | _T) -> int | float | _T:
        return x


class Child1_1(Parent1[str]):
    @overload
    def m1(self, x: bool) -> int: ...

    @overload
    def m1(self, x: str) -> str: ...

    def m1(self, x: bool | str) -> int | str:
        return x


class Child1_2(Parent1[str]):
    def m1(self, x: Any) -> Any:
        return x


class Child1_3(Parent1[str]):
    @overload
    def m1(self, x: bool) -> int: ...

    @overload
    def m1(self, x: str) -> str: ...

    def m1(self, x: bool | str) -> int | float | str:
        return x


class Child1_4(Parent1[str]):
    @overload
    def m1(self, x: str) -> str: ...

    @overload
    def m1(self, x: bool) -> int: ...

    # This should generate an error because the overloads are
    # in the wrong order.
    def m1(self, x: bool | str) -> int | float | str:
        return x


class Child1_5(Parent1[str]):
    @overload
    def m1(self, x: Literal[True]) -> int: ...

    @overload
    def m1(self, x: Literal[False]) -> float: ...

    @overload
    def m1(self, x: bytes) -> bytes: ...

    # This should generate an error because the overloads are
    # in the wrong order.
    def m1(self, x: bool | bytes) -> int | float | bytes:
        return x


class Child1_6(Parent1[bytes]):
    @overload
    def m1(self, x: Literal[True]) -> int: ...

    @overload
    def m1(self, x: Literal[False]) -> float: ...

    @overload
    def m1(self, x: bytes) -> bytes: ...

    def m1(self, x: bool | bytes) -> int | float | bytes:
        return x


class Parent2(Generic[_T]):
    @overload
    def method1(self: "Parent2[int]", x: list[int]) -> list[int]: ...

    @overload
    def method1(self, x: str) -> dict[str, str]: ...

    def method1(self, x: Any) -> Any: ...

    @overload
    def method2(self: "Parent2[int]", x: list[int]) -> list[int]: ...

    @overload
    def method2(self, x: str) -> dict[str, str]: ...

    @overload
    def method2(self, x: int) -> int: ...

    def method2(self, x: Any) -> Any: ...

    @overload
    @classmethod
    def method3(cls: "type[Parent2[int]]", x: list[int]) -> list[int]: ...

    @overload
    @classmethod
    def method3(cls, x: str) -> dict[str, str]: ...

    @classmethod
    def method3(cls, x: Any) -> Any: ...

    @overload
    @classmethod
    def method4(cls: "type[Parent2[int]]", x: list[int]) -> list[int]: ...

    @overload
    @classmethod
    def method4(cls, x: str) -> dict[str, str]: ...

    @overload
    @classmethod
    def method4(cls, x: int) -> int: ...

    @classmethod
    def method4(cls, x: Any) -> Any: ...


class Child2_1(Parent2[str]):
    def method1(self, x: str) -> dict[str, str]: ...


class Child2_2(Parent2[str]):
    @overload
    def method2(self, x: str) -> dict[str, str]: ...

    @overload
    def method2(self, x: int) -> int: ...

    def method2(self, x: Any) -> Any: ...


class Child2_3(Parent2[str]):
    @classmethod
    def method3(cls, x: str) -> dict[str, str]: ...


class Child2_4(Parent2[str]):
    @overload
    @classmethod
    def method4(cls, x: str) -> dict[str, str]: ...

    @overload
    @classmethod
    def method4(cls, x: int) -> int: ...

    @classmethod
    def method4(cls, x: Any) -> Any: ...


class Parent3:
    @overload
    def method(self, x: int) -> int: ...

    @overload
    def method(self, x: str) -> str: ...

    def method(self, x: int | str) -> int | str:
        return x


class Child3_1(Parent3):
    @overload
    def method(self, x: int) -> int: ...

    @overload
    def method(self, x: str) -> str: ...

    @overload
    def method(self, x: list[float]) -> list[float]: ...

    def method(self, x: int | str | list[float]) -> int | str | list[float]:
        return x


class Parent4(Generic[_T]):
    @overload
    def m1(self: "Parent4[int]", a: None) -> float: ...

    @overload
    def m1(self: "Parent4[int]", a: int) -> float: ...

    @overload
    def m1(self: "Parent4[float]", a: None) -> str: ...

    def m1(self, a: int | None = None) -> float | str:
        raise NotImplementedError


class Child4_1(Parent4[int]):
    @overload
    def function(self: Parent4[int], a: None) -> float: ...

    @overload
    def function(self: Parent4[int], a: int) -> float: ...

    def function(self, a: int | None = None) -> float:
        return 0.0


class Parent5:
    @overload
    def m1(self, x: int) -> int: ...

    @overload
    def m1(self, x: str) -> str: ...

    def m1(self, x: int | str) -> int | str: ...


class Parent5_1(Parent5):
    @overload
    def m1(self, x: bytes) -> bytes: ...

    @overload
    def m1(self, x: str) -> str: ...

    # This should generate an error because the overloads are
    # incompatible
    def m1(self, x: bytes | str) -> bytes | str: ...
