# This sample tests the case where a member access expression is used
# to access an instance method on a metaclass. Binding should not be
# performed in this case.

from enum import EnumMeta
from typing import TypeVar

_EnumMemberT = TypeVar("_EnumMemberT")


class EnumMeta2(EnumMeta):
    def __getitem__(cls: type[_EnumMemberT], name: str) -> _EnumMemberT:
        return EnumMeta.__getitem__(cls, name)


class MyMeta(type):
    @classmethod
    def meta_method(cls) -> None: ...


MyMeta.meta_method()
