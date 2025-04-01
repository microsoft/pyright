# This sample tests the logic that emits errors when
# covariant and contravariant TypeVars are used incorrectly
# for method parameters and return types.

from typing import Generic, TypeVar

_T = TypeVar("_T")
_T_co = TypeVar("_T_co", covariant=True)
_T_contra = TypeVar("_T_contra", contravariant=True)


class ClassA(Generic[_T, _T_co, _T_contra]):
    def func1(self, a: _T):
        pass

    # This should generate an error because covariant
    # TypeVars are not allowed for input parameters.
    def func2(self, a: _T_co):
        def inner(b: _T_co) -> None:
            pass

        return inner

    def func3(self, a: int | _T_co):
        pass

    def func4(self, a: list[_T_co]):
        pass

    def func5(self, a: _T_contra):
        pass

    def func6(self) -> _T | None:
        pass

    def func7(self) -> _T_co | None:
        pass

    # This should generate an error because contravariant
    # TypeVars are not allowed for return parameters.
    def func8(self) -> _T_contra: ...

    # This should generate an error because contravariant
    # TypeVars are not allowed for return parameters.
    def func9(self) -> _T_contra | int:
        return 3

    # This should generate an error because contravariant
    # TypeVars are not allowed for return parameters.
    def func10(self, x: _T_contra):
        return x

    def func11(self) -> list[_T_contra]:
        return []


class ClassB:
    def func1(self, a: _T_co) -> _T_co:
        return a

    def func2(self, a: _T_contra) -> _T_contra:
        return a
