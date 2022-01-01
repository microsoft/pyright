# This sample tests type narrowing of tuples based on len(x) test.

from typing import Literal, Tuple, TypeVar, Union


def func1(val: Union[Tuple[int], Tuple[int, int], Tuple[str, str]]):
    if len(val) == 1:
        t1: Literal["Tuple[int]"] = reveal_type(val)
    else:
        t2: Literal["Tuple[int, int] | Tuple[str, str]"] = reveal_type(val)

    if len(val) != 2:
        t3: Literal["Tuple[int]"] = reveal_type(val)
    else:
        t4: Literal["Tuple[int, int] | Tuple[str, str]"] = reveal_type(val)


def func2(val: Union[Tuple[int], Tuple[int, ...]]):
    if len(val) == 1:
        t1: Literal["Tuple[int] | Tuple[int, ...]"] = reveal_type(val)
    else:
        t2: Literal["Tuple[int, ...]"] = reveal_type(val)

    if len(val) != 2:
        t3: Literal["Tuple[int] | Tuple[int, ...]"] = reveal_type(val)
    else:
        t4: Literal["Tuple[int, ...]"] = reveal_type(val)


def func3(val: Union[Tuple[int], Tuple[()]]):
    if len(val) == 0:
        t1: Literal["Tuple[()]"] = reveal_type(val)
    else:
        t2: Literal["Tuple[int]"] = reveal_type(val)


_T1 = TypeVar("_T1", bound=Tuple[int])
_T2 = TypeVar("_T2", bound=Tuple[str, str])


def func4(val: Union[_T1, _T2]) -> Union[_T1, _T2]:
    if len(val) == 1:
        t1: Literal["_T1@func4"] = reveal_type(val)
    else:
        t2: Literal["_T2@func4"] = reveal_type(val)

    return val
