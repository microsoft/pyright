# This sample tests errors involving raw descriptors and bound functions.


class Example:
    @classmethod
    def cm(cls, value: int) -> str:
        return str(value)

    @staticmethod
    def sm(value: int) -> str:
        return str(value)

    # This should generate an error because raw classmethods are not callable.
    cm(1)

    # This should generate an error because the argument must be an int.
    sm("a")

    # This should generate an error because __func__ is read-only.
    sm.__func__ = sm.__func__


# This should generate an error because attribute access returns the function.
Example.sm.__func__
