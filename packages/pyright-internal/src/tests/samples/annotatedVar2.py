# This sample tests annotated types on global variables.

# This should generate an error because the declared
# type below does not match the assigned type.
glob_var1 = 4

# This should generate an error because the declared
# type doesn't match the later declared type.
glob_var1 = Exception()  # type: str

glob_var1 = Exception()  # type: Exception

# This should generate an error because the assigned
# type doesn't match the declared type.
glob_var1 = "hello"  # type: Exception

# This should generate an error.
glob_var2 = 5


def func1():
    global glob_var1
    global glob_var2

    # This should generate an error.
    glob_var1 = 3

    glob_var2 = "hello"  # type: str
