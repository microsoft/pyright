# This sample tests the detection and handling of asymmetric descriptors
# and properties. Type narrowing should be disabled in these cases.

from typing import Any, Literal, Optional


class A:
    @property
    def prop1(self) -> Optional[int]:
        ...

    @prop1.setter
    def prop1(self, val: Optional[int]) -> None:
        ...

    @property
    def prop2(self) -> Optional[int]:
        ...

    @prop2.setter
    def prop2(self, val: int) -> None:
        ...

    @property
    def prop3(self) -> int:
        ...

    @prop3.setter
    def prop3(self, val: Optional[int]) -> None:
        ...


def func1(obj: A) -> Literal[3]:
    obj.prop1 = None

    b: None = obj.prop1

    obj.prop1 = 3

    obj.prop1 + 1
    return obj.prop1


def func2(obj: A) -> Literal[3]:
    obj.prop2 = 3

    # This should generate an error because prop2 isn't
    # narrowed in this case.
    b: int = obj.prop2

    # This should generate an error because prop2 isn't
    # narrowed in this case.
    return obj.prop2


def func3(obj: A) -> Literal[3]:
    obj.prop3 = 3

    b: int = obj.prop3

    # This should generate an error because prop2 isn't
    # narrowed in this case.
    return obj.prop3


class Descriptor1:
    def __get__(self, instance: Any, owner: Any) -> Optional[int]:
        ...

    def __set__(self, owner: Any, value: Optional[int]) -> None:
        ...


class Descriptor2:
    def __get__(self, instance: Any, owner: Any) -> Optional[int]:
        ...

    def __set__(self, owner: Any, value: int) -> None:
        ...


class Descriptor3:
    def __get__(self, instance: Any, owner: Any) -> int:
        ...

    def __set__(self, owner: Any, value: Optional[int]) -> None:
        ...


class B:
    desc1: Descriptor1
    desc2: Descriptor2
    desc3: Descriptor3


def func4(obj: B) -> Literal[3]:
    obj.desc1 = None

    b: None = obj.desc1

    obj.desc1 = 3

    obj.desc1 + 1
    return obj.desc1


def func5(obj: B) -> Literal[3]:
    obj.desc2 = 3

    # This should generate an error because desc2 isn't
    # narrowed in this case.
    b: int = obj.desc2

    # This should generate an error because desc2 isn't
    # narrowed in this case.
    return obj.desc2


def func6(obj: B) -> Literal[3]:
    obj.desc3 = 3

    b: int = obj.desc3

    # This should generate an error because prop2 isn't
    # narrowed in this case.
    return obj.desc3
