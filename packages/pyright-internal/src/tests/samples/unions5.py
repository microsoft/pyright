# This sample tests the handling of runtime union expressions that
# are used in contexts other than a type annotation.

from typing import Union


class Foo:
    a: int


class Bar:
    a: int


a1: type[Foo] | type[Bar] = Foo | Bar

# This should generate an error
print(a1.a)

# This should generate an error
a1()

a2: type[Foo] | type[Bar] = Union[Foo, Bar]

# This should generate an error
print(a2.a)

# This should generate an error
a2()


b1 = Foo | Bar

# This should generate an error
print(b1.a)

# This should generate an error
b1()


b2 = Union[Foo, Bar]

# This should generate an error
print(b2.a)

# This should generate an error
b2()
