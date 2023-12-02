# This sample tests the a class-based decorator that uses a
# __get__ method as a way to provide access to a __call__ method.

# pyright: reportIncompatibleMethodOverride=false


class Wrapper:
    def __init__(self, func):
        self.func = func

    def __get__(self, instance, owner):
        return lambda **kwargs: self.func(instance, wrapped=True, **kwargs)


class Foo:
    @Wrapper
    def __init__(self, **kwargs):
        print(f"{kwargs}")


Foo(bar=3)
