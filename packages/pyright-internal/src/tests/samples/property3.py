# This sample tests the type checker's ability to handle
# custom subclasses of property.


from typing import Any, Callable


class custom_property1(property):
    pass


class Custom1(object):
    @custom_property1
    def x(self) -> int:
        return 3

    @custom_property1
    def y(self) -> float:
        return 3.5

    @y.setter
    def y(self, val: float):
        pass

    @y.deleter
    def y(self):
        pass


m1 = Custom1()

a1: int = m1.x

# This should generate an error because m.x is
# an int and cannot be assigned to str.
b1: str = m1.x

c1: float = m1.y

# This should generate an error because m.y is
# a float and cannot be assigned to int.
d1: int = m1.y

# This should generate an error because there
# is no setter for x.
m1.x = 4

m1.y = 4

# This should generate an error because there is
# no deleter for x.
del m1.x

del m1.y


class custom_property2(property):
    _custom_func: Callable[..., Any] | None

    def custom_function(self, _custom_func: Callable[..., Any]):
        self._custom_func = _custom_func
        return self


class Custom2(object):
    @custom_property2
    def x(self) -> int:
        return 3

    @custom_property2
    def y(self) -> float:
        return 3.5

    @y.setter
    def y(self, val: float):
        pass

    @y.deleter
    def y(self):
        pass

    @y.custom_function
    def y(self):
        pass


m2 = Custom2()

a2 = m2.y
reveal_type(a2, expected_text="float")

m2.y = 4
del m2.y
