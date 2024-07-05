# This sample tests that a type variable existing in a union type
# of multiple type variables is treated as covariant with the
# union type, thus affecting the variance restriction.

from typing import Protocol, TypeVar

# pyright: strict

_T1 = TypeVar("_T1")
_T1_co = TypeVar("_T1_co", covariant=True)
_T1_contra = TypeVar("_T1_contra", contravariant=True)

_T2 = TypeVar("_T2")
_T2_co = TypeVar("_T2_co", covariant=True)
_T2_contra = TypeVar("_T2_contra", contravariant=True)


# This is right, as `_T1_co` and `_T2_co` are only covariant with
# return type.
class P1(Protocol[_T1_co, _T2_co]):
    def m1(self) -> _T1_co | _T2_co: ...


# This is right, as `_T1_contra` and `_T2_contra` are only covariant
# with the argument type.
class P2(Protocol[_T1_contra, _T2_contra]):
    def m1(self, a: _T1_contra | _T2_contra) -> None: ...


# This is right, as `_T1` and `_T2` are both covariant with the
# argument type and the return type.
class P3(Protocol[_T1, _T2]):
    def m1(self, a: _T1, b: _T2) -> _T1 | _T2: ...


# This is right, as `_T1` and `_T2` are both covariant with the
# argument type and the return type.
class P4(Protocol[_T1, _T2]):
    def m2(self, a: _T1 | _T2) -> tuple[_T1, _T2]: ...
