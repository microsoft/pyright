# This sample tests for generic protocol variance consistency.

from typing import Protocol, TypeVar
from typing_extensions import ParamSpec  # pyright: ignore[reportMissingModuleSource]

# pyright: strict

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", bound=int)
_T3 = TypeVar("_T3", bytes, str)
_T1_co = TypeVar("_T1_co", covariant=True)
_T1_contra = TypeVar("_T1_contra", contravariant=True)


class Protocol1(Protocol[_T1, _T2, _T3]):
    def m1(self, p0: _T1, p1: _T2, p2: _T3) -> _T1 | _T2: ...

    def m2(self) -> _T1: ...

    def m3(self) -> _T2: ...

    def m4(self) -> _T3: ...


# This should generate an error because _T3 should be contravariant
class Protocol2(Protocol[_T1, _T2, _T3]):
    def m1(self, p0: _T1, p1: _T2, p2: _T3) -> _T1: ...

    def m2(self) -> _T1: ...

    def m3(self) -> _T2: ...


class Protocol3(Protocol[_T1_co]):
    def m1(self) -> None:
        pass


# This should generate an error because _T1 should be contravariant.
class Protocol4(Protocol[_T1]):
    def m1(self, p0: _T1) -> None: ...


# This should generate an error because _T1_co should be contravariant.
class Protocol5(Protocol[_T1_co]):
    # This should generate an error because a covariant TypeVar
    # should not be used as a parameter type.
    def m1(self, p0: _T1_co) -> None: ...


# This should generate an error because _T1 should be covariant.
class Protocol6(Protocol[_T1]):
    def m1(self) -> _T1: ...


# This should generate an error because _T1_contra should be covariant.
class Protocol7(Protocol[_T1_contra]):
    # This should generate an error because a contravariant TypeVar
    # should not be used as a return type.
    def m1(self) -> _T1_contra: ...


class Protocol8(Protocol[_T1]):
    def m1(self) -> _T1: ...

    def m2(self, p1: _T1) -> None:
        pass


P = ParamSpec("P")
R = TypeVar("R", covariant=True)


class Callback(Protocol[P, R]):
    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R: ...


class Protocol9(Protocol[_T1_co]):
    @property
    def prop1(self) -> _T1_co: ...


class Protocol10(Protocol[_T1_co]):
    def m1(self) -> type[_T1_co]: ...


class Protocol11(Protocol[_T1]):
    x: _T1 | None


class Protocol12(Protocol[_T1_contra]):
    def m1(self: "Protocol12[_T1_contra]", x: _T1_contra) -> None: ...

    @classmethod
    def m2(cls: "type[Protocol12[_T1_contra]]") -> None: ...
