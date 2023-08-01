# This sample tests the handling of multiple unpack operators in a
# star expression.

a = [1, 2]
b = ["3", "4"]

# This should generate an error for versions of Python <3.9
for x in *a, *b:
    print(x)

c = *a, *b
print(c)

# This should always generate an error.
*a, *b = (1, 2)


def func1(x: str):
    "".join([*sorted([x])])
