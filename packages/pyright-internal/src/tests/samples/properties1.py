# This sample tests the type checker's ability to validate
# properties.


class ClassA(object):
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

val = a.read_only_prop

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
