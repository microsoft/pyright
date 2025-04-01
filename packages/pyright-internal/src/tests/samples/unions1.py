# This sample tests the alternative syntax for unions as
# documented in PEP 604.

from typing import Callable, Generic, TypeVar, Union


def func1(a: int | str):
    if isinstance(a, int):
        return 1
    else:
        return 2


B = bytes | None | Callable[[], None]
A = int | str | B


def func2(a: A) -> B:
    if a == 3 or a is None:
        return b""
    elif not isinstance(a, (int, str, bytes)):
        a()


def func3(A: "int | str"):
    return 1


T = TypeVar("T")


def func4(a: str):
    def helper(value: T) -> T | None: ...

    class Baz(Generic[T]):
        qux: T | None

    reveal_type(helper(a), expected_text="str | None")
    reveal_type(Baz[str]().qux, expected_text="str | None")


T = TypeVar("T")
TT = TypeVar("TT", bound=type)


def decorator1(value: type[T]) -> type[T]: ...


def decorator2(value: TT) -> TT: ...


class ClassA:
    class ClassA_A:
        pass

    @decorator1
    class ClassA_B:
        pass

    @decorator2
    class ClassA_C:
        pass


a_or_str: "ClassA.ClassA_A | str"
b_or_str: "ClassA.ClassA_B | str"
b_or_str_Union: Union[ClassA.ClassA_B, str]
c_or_str: "ClassA.ClassA_C | str"

Alias1 = None | str
Alias2 = str | None

_T = TypeVar("_T")

Alias3 = _T | str
Alias4 = str | _T
