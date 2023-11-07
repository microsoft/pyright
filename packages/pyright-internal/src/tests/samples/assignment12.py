# This sample tests the case where a variable with a declared type
# is assigned an unknown value or partially-unknown value.


def a_test(x: int):
    u = x.upper()  # type: ignore
    reveal_type(u, expected_text="Unknown")

    # This should generate an error if reportUnknownVariableType is enabled.
    y: str = u
    reveal_type(y, expected_text="Unknown | str")


def b_test(x: int | str):
    u = x.upper()  # type: ignore
    reveal_type(u, expected_text="str | Unknown")

    # This should generate an error if reportUnknownVariableType is enabled.
    y: str = u
    reveal_type(y, expected_text="str | Unknown")
