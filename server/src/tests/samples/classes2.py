# This sample tests the reportIncompatibleMethodOverride
# configuration option.

class ParentClass():
    def my_method(self, a: int):
        return 1

class ChildClass(ParentClass):
    # This should generate an error if reportIncompatibleMethodOverride
    # is enabled.
    def my_method(self, a: str):
        return 1
