# This sample tests that a module is assignable
# to the built-in type "ModuleType".

import typing
import importlib
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
