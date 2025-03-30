# This sample tests the handling of a class with a custom
# __class_getitem__ class method.


from typing import Generic, TypeVar


class ClassA:
    # This should generate a warning because __class_getitem__
    # is implicitly a classmethod and should use cls rather than
    # self.
    def __class_getitem__(self, args: tuple[int, ...]) -> None: ...


reveal_type(ClassA[10, 63], expected_text="type[ClassA]")


_T = TypeVar("_T")
_S = TypeVar("_S")


class ClassB(Generic[_T, _S]):
    # Even though this class has a __class_getitem__ method,
    # it will be assumed to follow normal generic class semantics.
    def __class_getitem__(cls, args: tuple[int, ...]) -> None: ...


reveal_type(ClassB[int, str], expected_text="type[ClassB[int, str]]")
