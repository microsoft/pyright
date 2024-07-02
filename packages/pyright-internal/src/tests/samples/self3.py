# This sample tests the special-case handling of Self when comparing
# two functions whose signatures differ only in the Self scope.


class SomeClass:
    def __str__(self) -> str: ...

    __repr__ = __str__
