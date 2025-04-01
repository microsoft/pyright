# This sample tests the reportMissingParameterType check.


class A:
    # This should generate an error if reportMissingParameterType is enabled
    # because 'y' is missing a type annotation.
    def method1(self, x: int, _, y) -> int: ...

    def method2(self, x, y):
        # type: (int, int) -> int
        ...


def g(__p: int, x: int, y: str): ...
