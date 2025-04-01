# This sample verifies that the "logical or" operator
# is supported for classes that have a custom metaclass
# with a __or__ or __ror__ method defined.

# pyright: reportIncompatibleMethodOverride=false

from typing import Type, TypeVar


class ClassWithNoMeta1:
    pass


class ClassWithNoMeta2:
    pass


NoMetaUnion = ClassWithNoMeta1 | ClassWithNoMeta2


def func1(x: NoMetaUnion):
    reveal_type(x, expected_text="ClassWithNoMeta1 | ClassWithNoMeta2")


_T = TypeVar("_T")


class Metaclass1(type):
    def __or__(cls: _T, other: type) -> _T: ...


class Metaclass2(type):
    def __ror__(cls: _T, other: type) -> _T: ...


class ClassWithMeta1(metaclass=Metaclass1):
    pass


class ClassWithMeta2(metaclass=Metaclass2):
    pass


def requires_class_with_meta1(val: Type[ClassWithMeta1]):
    pass


MetaOr1 = ClassWithMeta1 | ClassWithNoMeta1
requires_class_with_meta1(MetaOr1)
