# This sample tests the type checker's ability to validate
# properties.


from typing import Self


class ClassA:
    @property
    def read_only_prop(self):
        return 1

    @property
    def read_write_prop(self):
        return "hello"

    @read_write_prop.setter
    def read_write_prop(self, value: str):
        return

    @property
    def deletable_prop(self):
        return 1

    @deletable_prop.deleter
    def deletable_prop(self):
        return


a = ClassA()

# These are disabled because fget, fset and fdel are not
# properly modeled for type checking.
# ClassA.read_only_prop.fget(ClassA())
# ClassA.read_write_prop.fset(ClassA(), "")
# ClassA.deletable_prop.fdel(ClassA())

val = a.read_only_prop

reveal_type(ClassA.read_only_prop, expected_text="property")
reveal_type(ClassA.read_only_prop.__doc__, expected_text="str | None")

# This should generate an error because this
# property has no setter.
a.read_only_prop = val

# This should generate an error because this
# property has no deleter.
del a.read_only_prop

val = a.read_write_prop

a.read_write_prop = "hello"

# This should generate an error because the type
# is incorrect.
a.read_write_prop = ClassA()

# This should generate an error because this
# property has no deleter.
del a.read_write_prop

val = a.deletable_prop

# This should generate an error because this
# property has no setter.
a.deletable_prop = val

del a.deletable_prop


class ClassB:
    @property
    def name(self) -> str:
        return "bar"


p1: property = ClassA.read_only_prop
p2: property = ClassA.read_write_prop
p3: property = ClassA.deletable_prop


class ClassC:
    @property
    def prop1(self) -> type[Self]: ...

    def method1(self) -> None:
        reveal_type(self.prop1, expected_text="type[Self@ClassC]")


class ClassD(ClassC):
    def method1(self) -> None:
        reveal_type(self.prop1, expected_text="type[Self@ClassD]")
