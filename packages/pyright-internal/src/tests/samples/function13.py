# This sample tests the reportFunctionMemberAccess diagnostic rule.


def func1():
    pass


a = func1.__annotations__
b = func1.__class__

# This should generate an error
c = func1.bar

# This should generate an error
func1.baz = 3

# This should generate an error
del func1.baz
