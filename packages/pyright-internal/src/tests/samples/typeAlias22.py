# This sample tests handling of type aliases.

from datetime import datetime
from typing import Any, Callable, Generic, TypeVar, Union


from typing import TypeVar, Union, Optional

S = TypeVar("S")

Response1 = Optional[Union[S, int]]


def f1_1() -> Response1[str]:
    return None


def f1_2() -> Response1[str]:
    return "s"


def f1_3() -> Response1[float]:
    # This should generate an error.
    return "s"


Response2 = Union[S, int]


def f2_1() -> Response2[Any]:
    return "s"


def f2_2() -> Response2[str]:
    return "s"


def f2_3() -> Response2[float]:
    return 3.4


def f2_4() -> Response2[datetime]:
    # This should generate an error
    return 3.4


Response3 = Callable[[S], S]


def response2(query: str) -> Response3[int]:
    return lambda x: x + 2


def response3(query: str) -> Response3[datetime]:
    # This should generate an error because datetime doesn't support +
    return lambda x: x + 2


Response4 = Union[S, int, str]


class Foo1:
    pass


class Foo2:
    pass


class Foo3:
    pass


T = TypeVar("T")

Response5 = Union[T, Foo1, Foo2]

# Test nested type aliases
Response6 = Response5[Response4[Foo3]]


def f6_1() -> Response6:
    return Foo1()


def f6_2() -> Response6:
    return Foo2()


def f6_3() -> Response6:
    return Foo3()


def f6_4() -> Response6:
    return 3


def f6_5() -> Response6:
    # This should generate an error
    return None


class InnerA:
    pass


class InnerB:
    pass


T = TypeVar("T", bound=InnerA)


class A(Generic[T]):
    pass


class B:
    pass


U = Union[A[T], B]

a: U[InnerA]

# This should generate an error because InnerB is not
# compatible with the type bound to TypeVar T.
b: U[InnerB]


V = Union[A[T], T]

# This should generate an error because too many type
# arguments are provided.
c: V[InnerA, int]
