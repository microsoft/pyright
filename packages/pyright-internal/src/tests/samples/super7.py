# This sample tests the use of super() with two arguments where the second
# argument is an instance.

from typing import Generic, TypeVar


T = TypeVar("T")


class BaseClass:
    def my_method(self, value: int) -> int: ...


class SubClass(BaseClass):
    def method_plain_super(self, value: int) -> int:
        reveal_type(super(), expected_text="BaseClass")
        return super().my_method(value)

    def method_super(self, value: int) -> int:
        reveal_type(super(__class__, self), expected_text="BaseClass")
        return super(__class__, self).my_method(value)

    def method_super_extra_arg(self, value: int) -> int:
        reveal_type(super(__class__, self), expected_text="BaseClass")

        # This should generate an error because the method is already bound.
        return super(__class__, self).my_method(self, value)

    @classmethod
    def classmethod_super(cls, value: int) -> int:
        self = cls()
        reveal_type(super(__class__, self), expected_text="BaseClass")
        return super(__class__, self).my_method(value)

    @classmethod
    def classmethod_super_extra_arg(cls, value: int) -> int:
        self = cls()
        reveal_type(super(__class__, self), expected_text="BaseClass")

        # This should generate an error.
        return super(__class__, self).my_method(self, value)

    @staticmethod
    def staticmethod_super(value: int) -> int:
        self = SubClass()
        reveal_type(super(__class__, self), expected_text="BaseClass")

        return super(__class__, self).my_method(value)

    @staticmethod
    def staticmethod_super_extra_arg(value: int) -> int:
        self = SubClass()
        reveal_type(super(__class__, self), expected_text="BaseClass")

        # This should generate an error.
        return super(__class__, self).my_method(self, value)


class A(Generic[T]): ...


class B(Generic[T]): ...


class C(A[int], B[T]):
    pass


c = C[str]()
super_obj_c = super(C, c)
reveal_type(super_obj_c, expected_text="A[int]")

super_obj_a = super(A, c)
reveal_type(super_obj_a, expected_text="B[str]")

super_obj_b = super(B, c)
reveal_type(super_obj_b, expected_text="object")


super_cls_c = super(C, C)
reveal_type(super_cls_c, expected_text="A[int]")

super_cls_a = super(A, C)
reveal_type(super_cls_a, expected_text="B[Unknown]")

super_cls_b = super(B, C)
reveal_type(super_cls_b, expected_text="object")
