# This sample tests the use of a pyright ignore comment in conjunction
# with the reportUnnecessaryTypeIgnoreComment mechanism.


def func1(self, x: int | None) -> str:
    # This should suppress the error
    v1 = x + "hi"  # pyright: ignore - test

    # This is unnecessary
    v2 = x + x  # pyright: ignore

    # This will not suppress the error
    # These are both unnecessary
    v3 = x + x  # pyright: ignore [foo, bar]

    # This will not suppress the error
    v4 = x + x  # pyright: ignore []

    # One of these is unnecessary
    v5 = x + "hi"  # test # pyright: ignore [reportOperatorIssue, foo]

    return 3  # pyright: ignore [reportReturnType]
