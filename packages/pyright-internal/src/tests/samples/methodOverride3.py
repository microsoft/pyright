# This sample tests incompatible method overrides for multiple inheritance.
# This functionality is controlled by the reportIncompatibleMethodOverride
# diagnostic rule.


from typing import Generic, Iterable, ParamSpec, TypeVar, overload


class A1:
    def func1(self, a: int) -> str: ...


class A2:
    def func1(self, a: int, b: int = 3) -> str: ...


# This should generate an error because func1 is incompatible.
class ASub(A1, A2): ...


class B1:
    def func1(self) -> int: ...


class B2:
    def func1(self) -> float: ...


class BSub(B1, B2): ...


class C1:
    def func1(self) -> float: ...


class C2:
    def func1(self) -> int: ...


# This should generate an error because func1 is incompatible.
class CSub(C1, C2): ...


class D1:
    def func1(self, a: int) -> None: ...


class D2:
    def func1(self, b: int) -> None: ...


# This should generate an error because func1 is incompatible.
class DSub(D1, D2): ...


_T_E = TypeVar("_T_E")


class E1(Generic[_T_E]):
    def func1(self, a: _T_E) -> None: ...


class E2(Generic[_T_E]):
    def func1(self, a: _T_E) -> None: ...


class ESub(E1[int], E2[int]): ...


_T_F = TypeVar("_T_F")


class F1(Generic[_T_F]):
    def do_stuff(self) -> Iterable[_T_F]: ...


class F2(F1[_T_F]):
    def do_stuff(self) -> Iterable[_T_F]: ...


class F3(F1[_T_F]): ...


class FSub1(F3[int], F2[int]):
    pass


class FSub2(F3[int], F1[int]):
    pass


class FSub3(F2[int], F1[int]):
    pass


_P = ParamSpec("_P")
_R = TypeVar("_R")


class G1(Generic[_P, _R]):
    def f(self, *args: _P.args, **kwargs: _P.kwargs) -> _R: ...

    def g(self) -> _R: ...


class G2(G1[_P, _R]):
    # This should generate an error because f is missing ParamSpec parameters.
    def f(self) -> _R: ...

    def g(self, *args: _P.args, **kwargs: _P.kwargs) -> _R: ...


class G3(G1[[], _R]):
    def f(self) -> _R: ...

    def g(self) -> _R: ...


class G4(G1[[int, int], str]):
    def f(self, a: int, b: int, /) -> str: ...

    def g(self) -> str: ...


class G5(G1[[], str]):
    # This should generate an error because the specialized
    # signature of f in the base class has no positional parameters.
    def f(self, a: int, b: int) -> str: ...

    def g(self) -> str: ...


class H1:
    @property
    def prop1(self) -> int:
        return 3

    @property
    def prop2(self) -> int:
        return 3

    @prop2.setter
    def prop2(self, val: int) -> None:
        pass

    @property
    def prop3(self) -> int:
        return 3

    @prop3.setter
    def prop3(self, val: int) -> None:
        pass


class H2:
    @property
    def prop1(self) -> str:
        return ""

    @property
    def prop2(self) -> int:
        return 3

    @property
    def prop3(self) -> int:
        return 3

    @prop3.setter
    def prop3(self, val: str) -> None:
        pass


# This should generate three errors: prop1, prop2 and prop3.
class H(H2, H1): ...


class I1:
    @overload
    def func1(self, x: int) -> int: ...

    @overload
    def func1(self, x: str) -> str: ...

    def func1(self, x: int | str) -> int | str:
        return x


class I2:
    @overload
    def func1(self, x: int) -> int: ...

    @overload
    def func1(self, x: str) -> str: ...

    def func1(self, x: int | str) -> int | str:
        return x


class I(I1, I2): ...
