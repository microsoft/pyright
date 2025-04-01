# This sample tests the special-case handling for __slots__ and
# __class_getitem__ during protocol matching.


from typing import Any, Iterable, Protocol


class B: ...


class C:
    def __class_getitem__(cls, __item: Any) -> Any: ...


class SupportsClassGetItem(Protocol):
    __slots__: str | Iterable[str] = ()

    def __class_getitem__(cls, __item: Any) -> Any: ...


b1: SupportsClassGetItem = B()  # OK (missing __class_getitem__ is ignored)
c1: SupportsClassGetItem = C()  # OK


# This should generate an error because __class_getitem__ is not exempt
# when performing class object protocol matching.
b2: SupportsClassGetItem = B  # Error
c2: SupportsClassGetItem = C  # OK
