# This sample tests type annotations for instance variables.


class ClassC(object):
    def __init__(self):
        self.inst_var1 = 3

    @property
    def prop1(self):
        return 1

    @prop1.setter
    def prop1(self, val):
        pass

    def foo(self):
        # This should generate an error because the assigned
        # type doesn't match the declared type.
        self.inst_var1 = 3  # type: str

        self.inst_var1: str = "hello"

        # This should generate an error because the declared
        # type doesn't match the previously declared type.
        self.inst_var1: int = "hello"

        # This should generate an error because the assigned
        # type doesn't match the declared type.
        self.inst_var1 = "hello"  # type: int

        self.prop1 = 3


class ClassE(ClassC):
    def __init__(self):
        # This should generate an error.
        self.inst_var1 = 3
