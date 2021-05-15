# This sample tests scoping rules for variables that are declared within
# a list comprehension statement.

a: str = "hello"

# The statement "len(a)" should not generate an
# error because "a" is not yet bound to the local
# variable at the time it is executed. Instead, it
# has the str type of the "a" in the outer scope.
b = [a for a in [len(a)]]

# This assignment should succeed because "a" at this
# point should have the type of "a" in the outer scope,
# not the int type from the list comprehension.
c: str = a
