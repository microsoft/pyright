# This sample tests the handling of unions between
# objects that provide a __get__ method and those
# that do not.

from typing import Any


class IntProvider:
    def __get__(self, instance: object, owner: Any) -> int:
        return 0


class Foo:
    _int_value_declared: IntProvider | int = 3
    _int_value_inferred = 3

    def __init__(self):
        pass

    def get_int_value_1(self) -> int:
        reveal_type(self._int_value_declared, expected_text="int")
        return self._int_value_declared

    def get_int_value_2(self) -> int:
        reveal_type(self._int_value_inferred, expected_text="int")
        return self._int_value_inferred
