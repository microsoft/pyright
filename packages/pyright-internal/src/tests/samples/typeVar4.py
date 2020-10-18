# This sample tests the logic that emits errors when
# covariant and contravariant TypeVars are used incorrectly
# for method parameters and return types.

from typing import Generic, List, TypeVar, Union

_T = TypeVar("_T")
_T_co = TypeVar("_T_co", covariant=True)
_T_contra = TypeVar("_T_contra", contravariant=True)


class Foo(Generic[_T, _T_co, _T_contra]):
    def func1(self, a: _T):
        pass

    # This should generate an error because covariant
    # TypeVars are not allowed for input parameters.
    def func2(self, a: _T_co):
        pass

    # This should generate an error because covariant
    # TypeVars are not allowed for input parameters.
    def func3(self, a: Union[int, _T_co]):
        pass

    def func4(self, a: List[_T_co]):
        pass

    def func5(self, a: _T_contra):
        pass

    def func6(self) -> _T:
        pass

    def func7(self) -> _T_co:
        pass

    # This should generate an error because contravariant
    # TypeVars are not allowed for return parameters.
    def func8(self) -> _T_contra:
        pass

    # This should generate an error because contravariant
    # TypeVars are not allowed for return parameters.
    def func9(self) -> Union[_T_contra, int]:
        pass

    def func10(self) -> List[_T_contra]:
        return []
