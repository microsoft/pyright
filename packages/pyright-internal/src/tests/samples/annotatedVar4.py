# This sample tests annotated types for class variables.


class ClassA(object):
    # This should generate an error because the declared
    # type doesn't match the latter declared type.
    class_var1 = 4  # type: str

    # This should generate an error because the assigned
    # value doesn't match the declared type.
    class_var1 = "hello"  # type: int

    class_var1 = 3  # type: int

    # This should generate an error because the declared
    # type doesn't match the latter declared type.
    class_var2 = 3  # type: int

    def __init__(self):
        # This should generate an error because the assigned
        # type doesn't match the declared type.
        self.class_var2 = 3  # type: str

        self.class_var2 = "hello"
