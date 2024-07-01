# This sample tests that __hash__ is set to None if
# __hash__ isn't set but __eq__ is.


class A: ...


A().__hash__()


class B:
    def __eq__(self, value: object) -> bool: ...

    ...


# This should generate an error because __hash__ is implicitly set to None
# for a class that defines __eq__ but not __hash__.
B().__hash__()
