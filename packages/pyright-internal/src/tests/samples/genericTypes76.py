# This sample tests the "constrained TypeVar narrowing for return types"
# feature. When a declared return type of a function contains a constrained
# TypeVar and the return statement is found on a path that tests a variable
# that is typed as that TypeVar, we know that the code path is taken only
# in the case where constraint is satisfied.

from typing import AnyStr, Generic, List, Optional, ParamSpec, TypeVar, Union
from typing_extensions import TypeVarTuple, Unpack

_T1 = TypeVar("_T1", str, int)
_T2 = TypeVar("_T2")


class A:
    ...


class B:
    ...


class C:
    ...


_T3 = TypeVar("_T3", A, B, C)

_P = ParamSpec("_P")
_Ts = TypeVarTuple("_Ts")


def func1(val1: _T1) -> _T1:
    if isinstance(val1, str):
        return ""
    return 0


def func2(val1: _T1) -> list[_T1]:
    if isinstance(val1, str):
        return [""]
    return [0]


class Class1(Generic[_T1, _T2, _T3, _P, Unpack[_Ts]]):
    def meth1(
        self, val1: _T1, val2: _T2, val3: _T3, cond: bool
    ) -> Union[List[_T1], List[_T2], List[_T3]]:
        if cond:
            # This should generate an error.
            return [0]

        if cond:
            if isinstance(val1, str):
                # This should generate an error.
                return [0]
            else:
                return [0]

        if cond:
            if isinstance(val3, B):
                return [B()]
            else:
                # This should generate an error.
                return [C()]

        if cond:
            if not isinstance(val3, B) and not isinstance(val3, C):
                return [A()]

        return [val1]

    def meth2(self, val1: _T1) -> _T1:
        val2 = val1

        while True:
            if isinstance(val2, str):
                return "hi"

            val2 = val2 = val1

            if isinstance(val2, int):
                return 0

    def meth3(self, val1: _T1, val2: _T3) -> _T1:
        if isinstance(val2, A):
            # This should generate an error.
            return 1

        if isinstance(val2, B):
            if isinstance(val1, str):
                return ""

        if isinstance(val1, int):
            if isinstance(val2, B):
                # This should generate an error.
                return ""

        raise BaseException()


def func3(s: AnyStr, y: Optional[AnyStr] = None) -> AnyStr:
    if isinstance(s, str):
        if y is None:
            pass
        return ""
    else:
        raise NotImplementedError
