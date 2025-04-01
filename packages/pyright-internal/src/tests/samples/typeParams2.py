# This sample tests that the use of PEP 695 type parameter syntax for generic
# classes and functions is flagged as an error if the version of Python
# is < 3.12.

# This should generate an error if <3.12
class ClassA[T, S]: ...


# This should generate an error if <3.12
def func1[T, S](): ...
