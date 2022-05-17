# This sample tests the type checker's ability to
# handle various class definition cases.


from typing import Type


class A:
    ...


class B:
    C: Type[A]


app = B()


class D(app.C):
    ...


class E:
    pass


class F(E):
    pass


class G(E, metaclass=type):
    def my_method(self):
        print(__class__)


# This should generate an error because only one metaclass is supported.
class H(E, metaclass=type, metaclass=type):
    pass


class I(E, other_keyword=2):
    pass


args = [1, 2, 3]
kwargs = {"foo": 5}


class J(*args, **kwargs):
    pass
