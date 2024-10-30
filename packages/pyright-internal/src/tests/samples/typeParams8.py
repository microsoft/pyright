# This sample tests the case where a class defined in an inner scope
# uses type variables from an outer scope.


class Parent[S, T]:
    def task(self, input: S) -> T: ...


def outer_func1[S, T]():
    class Child(Parent[S, T]):
        def task(self, input: S) -> T: ...

    return Child
