# This sample ensures that a variable of type "object" can be
# assigned any other type.

import os
from typing import Any, TypeVar, overload


class Foo:
    @overload
    def bar(self, obj: None) -> object:
        ...

    @overload
    def bar(self, obj: object) -> Any:
        ...

    @staticmethod
    def baz():
        return 3


my_obj: object

my_obj = None
my_obj = os
my_obj = Foo
my_obj = Foo()
my_obj = Foo.bar
my_obj = Foo.baz
my_obj = ()
my_obj = lambda x: x
my_obj = TypeVar("_T")

# This should generate an error because a is unbound.
my_obj = a
