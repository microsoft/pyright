# This sample is used in conjunction with final11.py to test that a module-scope
# "Final" whose initializer is not a literal keeps its declared type. Reading these
# symbols from another module is what forces the initializer to be evaluated, so
# this file must be analyzed before final11.py.

from typing_extensions import assert_type  # pyright: ignore[reportMissingModuleSource]

from .final11 import CALLBACK_BAD, CALLBACK_OK, CALLBACK_TYPE, ITEMS

assert_type(CALLBACK_OK(1), str)
assert_type(CALLBACK_BAD(1), str)
assert_type(CALLBACK_TYPE("x"), int)
assert_type(ITEMS, list[int])
