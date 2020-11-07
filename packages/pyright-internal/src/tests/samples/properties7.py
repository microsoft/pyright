# This sample tests member access expressions where the
# LHS is a class and the RHS is a property.


class A:
    def __init__(self):
        return

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
