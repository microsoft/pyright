# This sample verifies that the type checker is using
# synthesized type variables for "self" and "cls" variables.


class BaseClass:
    @classmethod
    def c(cls):
        return cls

    def f(self):
        return self


class SubClass(BaseClass):
    pass


def requires_subclass(p1: SubClass):
    pass


x = SubClass().f()
requires_subclass(x)

y = SubClass().c()
requires_subclass(y())
