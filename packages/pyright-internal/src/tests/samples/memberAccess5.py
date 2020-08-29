# This sample tests the handling of unions between
# objects that provide a __get__ method and those
# that do not.

from typing import Any, Union


class IntProvider:
    def __get__(self, instance: "IntProvider", owner: Any) -> int:
        return 0


class Foo:
    def __init__(self, value: Union[IntProvider, int]):
        self._int_value_declared: Union[IntProvider, int] = value
        self._int_value_inferred = value

    def get_int_value_1(self) -> int:
        return self._int_value_declared

    def get_int_value_2(self) -> int:
        return self._int_value_inferred

