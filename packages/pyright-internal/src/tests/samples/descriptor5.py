# This sample tests that assignment through an inherited asymmetric descriptor
# does not narrow subsequent reads to the setter's input type.

from typing import Any, assert_type, cast


class Getter[T]:
    def __get__(self, instance: Any, owner: Any = None) -> T:
        return cast(Any, None)


class Descriptor[T, U](Getter[T]):
    def __set__(self, instance: Any, value: T | U) -> None:
        pass


class IntFromStr(Descriptor[int, str]):
    pass


class Container:
    value: IntFromStr


container = Container()
container.value = "1"
assert_type(container.value, int)


class AsymmetricProperty:
    @property
    def value(self) -> int:
        return 0

    @value.setter
    def value(self, new_value: str) -> None:
        pass


prop = AsymmetricProperty()
prop.value = "1"
assert_type(prop.value, int)
