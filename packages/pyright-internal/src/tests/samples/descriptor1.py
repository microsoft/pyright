# This sample tests the detection and handling of asymmetric descriptors
# and properties. Type narrowing should be disabled in these cases.

from typing import Any, Hashable, Iterable, Literal, Self, overload


class A:
    @property
    def prop1(self) -> int | None: ...

    @prop1.setter
    def prop1(self, val: int | None) -> None: ...

    @property
    def prop2(self) -> int | None: ...

    @prop2.setter
    def prop2(self, val: int) -> None: ...

    @prop2.deleter
    def prop2(self) -> None: ...

    @property
    def prop3(self) -> int: ...

    @prop3.setter
    def prop3(self, val: int | None) -> None: ...

    @prop3.deleter
    def prop3(self) -> None: ...


def func1(obj: A) -> Literal[3]:
    obj.prop1 = None

    b: None = obj.prop1

    obj.prop1 = 3

    v1 = obj.prop1 + 1
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
    def __get__(self, instance: Any, owner: Any) -> int | None: ...

    def __set__(self, owner: Any, value: int | None) -> None: ...


class Descriptor2:
    def __get__(self, instance: Any, owner: Any) -> int | None: ...

    def __set__(self, owner: Any, value: int) -> None: ...


class Descriptor3:
    def __get__(self, instance: Any, owner: Any) -> int: ...

    def __set__(self, owner: Any, value: int | None) -> None: ...


class Descriptor4:
    @overload
    def __get__(self, instance: None, owner: Any) -> int: ...
    @overload
    def __get__(self, instance: Any, owner: Any) -> str: ...
    def __get__(self, instance: Any, owner: Any) -> int | str: ...

    def __set__(self, owner: Any, value: int | None) -> None: ...


class Descriptor5:
    def __get__(self, instance: Any, owner: Any) -> int: ...

    @overload
    def __set__(self, owner: bytes, value: int | None) -> None: ...
    @overload
    def __set__(self, owner: "B", value: int | None) -> None: ...
    def __set__(self, owner: Any, value: int | None) -> None: ...


class Descriptor6[GT, ST]:
    @overload
    def __get__(self, instance: None, owner: Any) -> Self: ...

    @overload
    def __get__(self, instance: Any, owner: Any) -> GT: ...
    def __get__(self, instance: Any, owner: Any) -> Any: ...

    def __set__(self, instance: Any, value: ST): ...


class B:
    desc1: Descriptor1
    desc2: Descriptor2
    desc3: Descriptor3
    desc4: Descriptor4
    desc5: Descriptor5
    desc6: Descriptor6[int | None, int | None]


def func4(obj: B) -> Literal[3]:
    obj.desc1 = None

    b: None = obj.desc1

    obj.desc1 = 3

    v1 = obj.desc1 + 1
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


def func7(obj: B):
    obj.desc4 = 3
    reveal_type(obj.desc4, expected_text="str")

    obj.desc5 = 3
    reveal_type(obj.desc5, expected_text="int")

    obj.desc6 = 1
    reveal_type(obj.desc6, expected_text="Literal[1]")
