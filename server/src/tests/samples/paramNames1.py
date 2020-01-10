# This sample tests the reportSelfClsParameterName setting.

def foo():
    pass


class Class1:
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
    def foo4(self):
        return 4


class Metaclass(type):
    # This should not generate a error because the class derives
    # from type and is assumed to be a metaclass.
    def foo1(cls):
        return 3

