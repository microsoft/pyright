# This sample tests that __hash__ is set to None if
# __hash__isn't set but __eq__ is


class A:
    ...

# This shouldn't error
A().__hash__()


class B:
    def __eq__(self, value: object) -> bool:
        ...
    ...

# This should error because __hash__ is set to None by Python
B().__hash__()
