# This sample tests the handling of runtime union expressions that
# are used in contexts other than a type annotation.

from types import UnionType
from typing import Optional, Union


class Class1:
    a: int


class Class2:
    a: int


# This should generate an error
a1: type[Class1] | type[Class2] = Class1 | Class2

# This should generate an error
a2: type[Class1] | type[Class2] = Union[Class1, Class2]


b1 = Class1 | Class2

# This should generate an error
print(b1.a)

# This should generate an error
b1()


b2 = Union[Class1, Class2]

# This should generate an error
print(b2.a)

# This should generate an error
b2()


c1: UnionType
c1 = int | str
c1 = Union[int, str]
c1 = Optional[int]
