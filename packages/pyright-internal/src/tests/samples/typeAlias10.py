# This sample tests the handling of generic type alias where a type
# argument is not provided.

# pyright: reportMissingTypeArgument=true

from typing import Any, Generic, TypeAlias, TypeVar

_T = TypeVar("_T")


class A(Generic[_T]): ...


# This should generate an error if reportMissingTypeArgument is enabled.
B: TypeAlias = A


v1: B = A()

# This should generate an error because B is already specialized.
v2: B[int] = A()

# This should generate an error if reportMissingTypeArgument is enabled.
v3: A = A()


C = A[str]


# This should generate an error because C is already specialized.
v4: C[int]


class D(Generic[_T]):
    def __getitem__(self, key: Any) -> int: ...


D_Alias = D[_T]

d: D_Alias[Any] = D()
item = d[0]

x: int = D_Alias[Any]()[0]

E: TypeAlias = _T

e1: E[int] = 3

# This should generate an error if reportMissingTypeArgument is enabled.
e2: E = 3
