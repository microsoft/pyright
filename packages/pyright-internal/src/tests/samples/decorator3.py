# This sample tests that arbitrary expressions (including
# subscripts) work for decorators. This support was added
# in Python 3.9.

my_decorators = (staticmethod, classmethod, property)


class Foo:
    # This should generate an error if version < 3.9.
    @my_decorators[0]
    def my_static_method():
        return 3

    # This should generate an error if version < 3.9.
    @my_decorators[1]
    def my_class_method(cls):
        return 3

    # This should generate an error if version < 3.9.
    @my_decorators[2]
    def my_property(self):
        return 3


Foo.my_static_method()
Foo.my_class_method()
Foo().my_property
