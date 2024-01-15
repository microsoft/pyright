# This sample tests the handling of the @no_type_check decorator.


from typing import no_type_check


@no_type_check
class A:
    # This should generate an error because no_type_check has
    # no effect when applied to a class.
    x: int = ""


@no_type_check
def func1(a: int, b: int(), *args, c: int = 3) -> dummy:
    x: int = ""


reveal_type(
    func1,
    expected_text="(a: Unknown, b: Unknown, *args: Unknown, c: Unknown = 3) -> Unknown",
)


# This should generate an error.
func1()

func1("", "", c="")
