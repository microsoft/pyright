# This sample tests the handling of deprecated properties and decorators.

from typing import overload

from typing_extensions import deprecated  # pyright: ignore[reportMissingModuleSource]


class A:
    @property
    @deprecated("Deprecated v1 getter")
    def v1(self) -> str:
        return ""

    @v1.setter
    def v1(self, value: str) -> None: ...

    @v1.deleter
    def v1(self) -> None: ...

    @property
    def v2(self) -> str:
        return ""

    @deprecated("Deprecated v2 setter")
    @v2.setter
    def v2(self, value: str) -> None: ...

    @v2.deleter
    @deprecated("Deprecated v2 deleter")
    def v2(self) -> None: ...


a = A()

# This should generate an error if reportDeprecated is enabled.
v1 = a.v1

a.v1 = ""
del a.v1


v2 = a.v2

# This should generate an error if reportDeprecated is enabled.
a.v2 = ""

# This should generate an error if reportDeprecated is enabled.
a.v2 += ""

# This should generate an error if reportDeprecated is enabled.
del a.v2


class DescB1:
    @overload
    @deprecated("DescB1 __get__")
    def __get__(self, obj: None, owner: object) -> str: ...

    @overload
    def __get__(self, obj: object, owner: object) -> str: ...

    def __get__(self, obj: object | None, owner: object) -> str:
        return ""


class DescB2:
    def __get__(self, obj: object | None, owner: object) -> str:
        return ""

    @deprecated("DescB2 __set__")
    def __set__(self, obj: object | None, value: str) -> None: ...

    @deprecated("DescB2 __delete__")
    def __delete__(self, obj: object | None) -> None: ...


class B:
    b1: DescB1 = DescB1()
    b2: DescB2 = DescB2()


# This should generate an error if reportDeprecated is enabled.
v3 = B.b1

b = B()
v4 = b.b1


# This should generate an error if reportDeprecated is enabled.
b.b2 = ""

# This should generate an error if reportDeprecated is enabled.
del b.b2
