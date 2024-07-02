# This sample tests support for PEP 696 (default types for TypeVars)
# when used to define generic functions and with defaults type
# expressions that refer to other type variables. This is the same
# as typeVarDefaultFunction2 except that it uses the PEP 695 syntax.

from typing import TypeVar


def func1[T1, T2 = list[T1]](x: T1, y: int | T2 = 0) -> T2 | list[T1]: ...


v1_1 = func1("hi", 3.4)
reveal_type(v1_1, expected_text="float | list[str]")

v1_2 = func1("")
reveal_type(v1_2, expected_text="list[str]")


# This should generate an error because T1 depends on T2.
def func2[T2 = list[T1], T1 = str]() -> None: ...
