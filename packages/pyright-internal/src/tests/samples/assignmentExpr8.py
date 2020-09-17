# This sample checks that parsing for the assignment expression
# operator is using the correct precedence. It should be parsing
# the RHS as a "test expression" which allows for ternary
# expressions.

result = None

if items := 3 if result else None:
    pass

print(items)
