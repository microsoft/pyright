# This sample tests that a module is assignable
# to the built-in type "ModuleType".

import typing
import importlib
from typing import Protocol
from types import ModuleType

importlib.reload(typing)


def func1(a: ModuleType):
    pass


func1(typing)


v1 = [importlib]
reveal_type(v1, expected_text="list[ModuleType]")

v2 = {importlib: typing}
reveal_type(v2, expected_text="dict[ModuleType, ModuleType]")

v3 = (importlib, typing)
reveal_type(v3, expected_text="tuple[ModuleType, ModuleType]")


class ModuleProto(Protocol):
    def reload(self, module: ModuleType) -> ModuleType: ...


v4: ModuleProto = importlib
reveal_type(v4, expected_text='Module("importlib")')

v5: tuple[ModuleProto] = (importlib,)
reveal_type(v5, expected_text='tuple[Module("importlib")]')

v6: list[ModuleProto] = [importlib]
reveal_type(v6, expected_text="list[ModuleProto]")
