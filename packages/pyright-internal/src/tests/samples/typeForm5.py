# This sample tests the TypeForm special form when used with type variables.

# pyright: reportMissingModuleSource=false

from typing import Literal, LiteralString, TypeGuard, Optional
from typing_extensions import TypeForm, TypeIs


def func1[T](x: TypeForm[T]) -> T: ...


def func2[S](x: TypeForm[S | None]) -> S: ...


def func3[S, T](x: TypeForm[S | T]) -> S: ...


def func4[T](x: object, t: TypeForm[T]) -> TypeIs[T]: ...


def func5[T](x: TypeForm[T]) -> TypeGuard[type[T]]: ...


v1 = func1(int | str)
reveal_type(v1, expected_text="int | str")

v2 = func1("int | str")
reveal_type(v2, expected_text="int | str")

v3 = func1(LiteralString)
reveal_type(v3, expected_text="LiteralString")

v4 = func1(Literal[1, 2, 3])
reveal_type(v4, expected_text="Literal[1, 2, 3]")

v5 = func2("Optional[str]")
reveal_type(v5, expected_text="str")

v6 = func2(int | str | None)
reveal_type(v6, expected_text="int | str")

v7 = func3(int | str | None)
reveal_type(v7, expected_text="int | str | None")

v8 = func4(1, int | str | None)
reveal_type(v8, expected_text="TypeIs[int | str | None]")

v9 = func5(int | str | None)
reveal_type(v9, expected_text="TypeGuard[type[int] | type[str] | type[None]]")
