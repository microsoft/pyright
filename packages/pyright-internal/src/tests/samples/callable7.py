# This sample tests the handling of the `__call__` attribute.


class A:
    def __init__(self):
        self.__call__ = self.method1

    def method1(self, a: int):
        return a


# This should generate an error because `__call__` is
# callable only if it's a class variable.
A()(0)


class B:
    def method1(self, a: int):
        return a

    __call__ = method1


B()(0)
