# This sample tests the case where super() is used for a class
# whose base classes are of unknown types.

from some_module import ClassUnknown  # type: ignore


class Class1(ClassUnknown):
    def __init__(self, x: int):
        # This should not generate an error.
        super(Class1, self).__init__(x, 1, 2, 3)
