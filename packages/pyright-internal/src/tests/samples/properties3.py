# This sample tests the type checker's ability to handle
# custom subclasses of property.


class custom_property(property):
    pass


class Custom(object):
    @custom_property
    def x(self) -> int:
        return 3

    @custom_property
    def y(self) -> float:
        return 3.5

    @y.setter
    def y(self, val: float):
        pass

    @y.deleter
    def y(self):
        pass


m = Custom()

a: int = m.x

# This should generate an error because m.x is
# an int and cannot be assigned to str.
b: str = m.x

c: float = m.y

# This should generate an error because m.y is
# a float and cannot be assigned to int.
d: int = m.y

# This should generate an error because there
# is no setter for x.
m.x = 4

m.y = 4

# This should generate an error because there is
# no deleter for x.
del m.x

del m.y
