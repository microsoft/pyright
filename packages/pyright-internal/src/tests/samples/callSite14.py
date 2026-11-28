# This sample tests that call-site return type inference leaves TypeVars
# bound when the call is within their scope.


def func1[T](value: T) -> T:
    def inner(a):
        return a

    return inner(value)


def func2[T](value: T) -> tuple[int, T]:
    def inner(a):
        return a, value

    return inner(1)


def func3[T](value: T) -> T:
    def inner(a):
        return [a]

    # This should generate an error.
    return inner(value)


class ClassA[T]:
    def method(self, a):
        return a

    def use1(self, value: T) -> T:
        return self.method(value)

    def use2(self, value: T) -> int:
        # This should generate an error.
        return self.method(value)
