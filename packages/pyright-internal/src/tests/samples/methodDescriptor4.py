# This sample tests canonical method metadata for class-scope descriptor aliases.

from typing import Self, assert_type


class Base:
    @classmethod
    def cm(cls, value: int) -> str:
        return str(value)

    @staticmethod
    def sm(value: int) -> str:
        return str(value)

    def __new__(cls, value: int) -> Self:
        return super().__new__(cls)


class Derived(Base):
    @classmethod
    def cm_impl(cls, value: int) -> str:
        return str(value)

    @staticmethod
    def sm_impl(value: int) -> str:
        return str(value)

    cm = cm_impl
    sm = sm_impl

    @staticmethod
    def new_impl[T: Base](class_type: type[T], text: str) -> T:
        return object.__new__(class_type)

    __new__ = new_impl


assert_type(Derived("a"), Derived)
assert_type(Derived.cm(1), str)
assert_type(Derived.sm(1), str)


class Grandchild(Derived): ...


assert_type(Grandchild("a"), Grandchild)
assert_type(Grandchild.cm(1), str)


class Constructor:
    def init_impl(self, text: str) -> None:
        self.text = text

    __init__ = init_impl


assert_type(Constructor("a"), Constructor)


class InvalidOverride(Base):
    @classmethod
    def cm_impl(cls, value: str) -> str:
        return value

    @staticmethod
    def sm_impl(value: str) -> str:
        return value

    # These should generate errors because the inherited signatures require int.
    cm = cm_impl
    sm = sm_impl
