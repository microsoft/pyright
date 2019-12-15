# This sample tests the reportIncompatibleMethodOverride
# configuration option.

class ParentClass():
    def my_method1(self, a: int):
        return 1

    def my_method2(self, a: int, b: int):
        return 1

class ChildClass(ParentClass):
    # This should generate an error if reportIncompatibleMethodOverride
    # is enabled.
    def my_method1(self, a: str):
        return 1

    # This should generate an error if reportIncompatibleMethodOverride
    # is enabled.
    def my_method2(self, a: int):
        return 1

