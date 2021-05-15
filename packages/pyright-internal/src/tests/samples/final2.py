# This sample tests the handling of the @final method decorator.

from typing import final


class ClassA:
    def func1(self):
        pass

    @classmethod
    def func2(cls):
        pass

    @final
    def func3(self):
        pass

    @final
    @classmethod
    def func4(cls):
        pass

    @final
    def _func5(self):
        pass

    @final
    def __func6(self):
        pass


class ClassB(ClassA):
    def func1(self):
        pass

    @classmethod
    def func2(cls):
        pass

    # This should generate an error because func3 is
    # defined as final.
    def func3(self):
        pass

    # This should generate an error because func3 is
    # defined as final.
    @classmethod
    def func4(cls):
        pass

    # This should generate an error because func3 is
    # defined as final.
    def _func5(self):
        pass

    # This should not generate an error because double
    # underscore symbols are exempt from this check.
    def __func6(self):
        pass
