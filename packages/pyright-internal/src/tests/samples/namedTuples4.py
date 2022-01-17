# This sample tests the case where a class derives from a named tuple.
# The synthesized __new__ method should be able to handle this.

from collections import namedtuple
from typing import NamedTuple


Class1 = namedtuple("Class1", "name")


class Class2(Class1):
    some_class_member = 1


reveal_type(Class2(name="a"), expected_text="Class2")

Class3 = NamedTuple("Class3", [("name", str)])


class Class4(Class3):
    some_class_member = 1


reveal_type(Class4(name="a"), expected_text="Class4")
