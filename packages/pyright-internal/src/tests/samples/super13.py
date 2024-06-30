# This sample tests the use of `super` outside of a method.


def func1(t: type) -> super:
    return super(t, t)


class ClassA:
    pass


func1(ClassA)
