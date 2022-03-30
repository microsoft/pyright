# This sample tests various dictionary diagnostics.

from typing import Generic, List, Mapping, TypeVar, Union

t1 = ()

# This should generate an error because t1 is not a mapping.
d1 = {**t1}


_KT = TypeVar("_KT")
_VT = TypeVar("_VT")


def func1(m: Union[Mapping[str, int], Mapping[str, str]]):
    d1 = {**m}
    reveal_type(d1, expected_text="dict[str, int | str]")


class MyMapping(Generic[_KT, _VT]):
    def keys(self) -> List[_KT]:
        raise NotImplementedError

    def __getitem__(self, key: _KT) -> _VT:
        raise NotImplementedError


def func2(m: Union[MyMapping[str, int], MyMapping[str, str]]):
    d1 = {**m}
    reveal_type(d1, expected_text="dict[str, int | str]")
