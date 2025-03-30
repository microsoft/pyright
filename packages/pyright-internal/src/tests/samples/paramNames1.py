# This sample tests the reportSelfClsParameterName setting.


from typing import overload


def foo():
    pass


class Class1:
    # This should generate an error or warning if the setting
    # is enabled because __new__ is expected to take cls.
    def __new__(blah):
        return super().__new__(blah)

    # This should generate an error or warning if the setting
    # is enabled because it's missing a "self" parameter.
    def foo1():
        return 3

    # This should generate an error or warning if the setting
    # is enabled because "self" is misspelled.
    def foo2(seeeelf):
        return 4

    # This should generate an error or warning if the setting
    # is enabled because "self" is misspelled.
    def foo3(cls):
        return 4

    @classmethod
    def foo4(cls):
        return 4

    @classmethod
    # This should generate an error or warning if the setting
    # is enabled because "cls" is expected.
    def foo5(self):
        return 4

    @overload
    # This should generate an error or warning if the setting
    # is enabled because "self" is expected.
    def foo6(x: "Class1") -> int: ...

    @overload
    # This should generate an error or warning if the setting
    # is enabled because "self" is expected.
    def foo6(x: int) -> str: ...

    # This should generate an error or warning if the setting
    # is enabled because "self" is expected.
    def foo6(x) -> int | str: ...

    @classmethod
    # This should generate an error or warning if the setting
    # is enabled because this isn't a metaclass.
    def foo7(mcls):
        return 4


class Metaclass(type):
    def __new__(mcls): ...

    # This should not generate a error because the class derives
    # from type and is assumed to be a metaclass.
    def foo1(cls):
        return 3

    # This should generate an error.
    def foo2(mcls):
        return 3

    def foo3(self):
        return 3

    @classmethod
    def foo4(cls):
        return 3

    @classmethod
    def foo5(metacls):
        return 3

    # This should generate an error.
    @classmethod
    def foo6(bar):
        return 3
