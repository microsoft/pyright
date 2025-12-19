# This tests type narrowing when setting an asymetric acsessor

from typing import assert_type

class MyAttr:
   def __set__(self, instance: object, value: float) -> None:
      ...

   def __get__(self, instance: object, owner: type) -> int | None:
      ...

class MyClass:
   attr: MyAttr

MyClass.attr = 1.5

# Should be able to narrow types after initial assignment
assert MyClass.attr is not None
assert_type(MyClass.attr, int)

# Assigning to the attribute should reset the type narrowing
MyClass.attr = 1.5
assert_type(MyClass.attr, int | None)
