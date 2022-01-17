# This sample tests the use of super() with two arguments where the second
# argument is an instance.


class BaseClass:
    def my_method(self, value: int) -> int:
        ...


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

        # This should generate an errorr.
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
