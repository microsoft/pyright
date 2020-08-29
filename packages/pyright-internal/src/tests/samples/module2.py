# This sample tests that a module is assignable
# to the built-in type "ModuleType".

import typing
import importlib

importlib.reload(typing)
