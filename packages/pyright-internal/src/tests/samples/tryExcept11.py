# This sample tests the case where a variable is initialized before
# a try/except and is referenced within the finally clause. This ensures
# that the "finally gate" logic is reentrant.


def func1():
    func2()


def func2():
    a = A()

    try:
        with open("path"):
            return
    finally:
        a.method1()


class A:
    def method1(self):
        pass
