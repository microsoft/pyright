# This sample tests the use of super() with two arguments where the second
# argument is an instance.

from typing import Literal


class BaseClass:
    def my_method(self, value: int) -> int:
        ...


class SubClass(BaseClass):
    def method_plain_super(self, value: int) -> int:
        t1: Literal["BaseClass"] = reveal_type(super())
        return super().my_method(value)

    def method_super(self, value: int) -> int:
        t1: Literal["BaseClass"] = reveal_type(super(__class__, self))
        return super(__class__, self).my_method(value)

    def method_super_extra_arg(self, value: int) -> int:
        t1: Literal["BaseClass"] = reveal_type(super(__class__, self))

        # This should generate an error because the method is already bound.
        return super(__class__, self).my_method(self, value)

    @classmethod
    def classmethod_super(cls, value: int) -> int:
        self = cls()
        t1: Literal["BaseClass"] = reveal_type(super(__class__, self))
        return super(__class__, self).my_method(value)

    @classmethod
    def classmethod_super_extra_arg(cls, value: int) -> int:
        self = cls()
        t1: Literal["BaseClass"] = reveal_type(super(__class__, self))

        # This should generate an errorr.
        return super(__class__, self).my_method(self, value)

    @staticmethod
    def staticmethod_super(value: int) -> int:
        self = SubClass()
        t1: Literal["BaseClass"] = reveal_type(super(__class__, self))

        return super(__class__, self).my_method(value)

    @staticmethod
    def staticmethod_super_extra_arg(value: int) -> int:
        self = SubClass()
        t1: Literal["BaseClass"] = reveal_type(super(__class__, self))

        # This should generate an error.
        return super(__class__, self).my_method(self, value)
