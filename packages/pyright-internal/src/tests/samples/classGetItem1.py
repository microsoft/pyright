# This sample tests the handling of a class with a custom
# __class_getitem__ class method.


from typing import Generic, Literal, TypeVar


class Foo:
    # This should generate a warning because __class_getitem__
    # is implicitly a classmethod and should use cls rather than
    # self.
    def __class_getitem__(self, args: tuple[int, ...]) -> None:
        ...


t1: Literal["Type[Foo]"] = reveal_type(Foo[10, 63])


_T = TypeVar("_T")
_S = TypeVar("_S")


class Bar(Generic[_T, _S]):
    # Even though this class has a __class_getitem__ method,
    # it will be assumed to follow normal generic class semantics.
    def __class_getitem__(cls, args: tuple[int, ...]) -> None:
        ...


t2: Literal["Type[Bar[int, str]]"] = reveal_type(Bar[int, str])
