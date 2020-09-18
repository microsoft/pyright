# This sample tests member accesses of classes and objects where
# the member is a property or an attribute handled by __getattr__.

class A:
    @property
    def value(self):
        return 42

    def __getattr__(self, name: str):
        return 0


b1 = A.value
# This should generate an error because __getattr__
# is not applied to a class.
b2 = A.blah
b3 = A.value.fget


a = A()

c1 = a.value
c2 = a.blah
# This should generate an error because a.value is
# the property value.
c3 = a.value.fget

