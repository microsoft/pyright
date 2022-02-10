# This sample tests type checking for match statements (as
# described in PEP 634) that contain literal patterns.


def test_unknown(value_to_match):
    match value_to_match:
        case 3 as a1, -3 as a2:
            reveal_type(a1, expected_text="Literal[3]")
            reveal_type(a2, expected_text="Literal[-3]")
            reveal_type(value_to_match, expected_text="Unknown")

        case 3j as b1, -3 + 5j as b2:
            reveal_type(b1, expected_text="complex")
            reveal_type(b2, expected_text="complex")
            reveal_type(value_to_match, expected_text="Unknown")

        case "hi" as c1, None as c2:
            reveal_type(c1, expected_text="Literal['hi']")
            reveal_type(c2, expected_text="None")
            reveal_type(value_to_match, expected_text="Unknown")

        case True as d1, False as d2:
            reveal_type(d1, expected_text="Literal[True]")
            reveal_type(d2, expected_text="Literal[False]")
            reveal_type(value_to_match, expected_text="Unknown")

def test_tuple(value_to_match: tuple[int | float | str | complex, ...]):
    match value_to_match:
        case (3, -3) as a1:
            reveal_type(a1, expected_text="tuple[Literal[3], Literal[-3]]")
            reveal_type(value_to_match, expected_text="tuple[Literal[3], Literal[-3]]")

        case (3j , -3 + 5j) as b1:
            reveal_type(b1, expected_text="tuple[complex, complex]")
            reveal_type(value_to_match, expected_text="tuple[complex, complex]")


def test_union(value_to_match: int | float | str | complex | bool | None):
    match value_to_match:
        case (3 | -3j) as a1:
            reveal_type(a1, expected_text="complex | Literal[3]")
            reveal_type(value_to_match, expected_text="complex | Literal[3]")

        case (True | False | 3.4 | -3 + 3j | None) as b1:
            reveal_type(b1, expected_text="float | complex | bool | None")
            reveal_type(value_to_match, expected_text="float | complex | bool | None")

        case ("hi" | 3.4) as c1:
            reveal_type(c1, expected_text="float | Literal['hi']")
            reveal_type(value_to_match, expected_text="float | Literal['hi']")

        case ((True | "True") as d1) | ((False | "False") as d1):
            reveal_type(d1, expected_text="bool | Literal['True', 'False']")
            reveal_type(value_to_match, expected_text="bool | Literal['True', 'False']")


def test_none(value_to_match: int | None):
    match value_to_match:
        case None as a1:
            reveal_type(a1, expected_text="None")

        case a2:
            reveal_type(a2, expected_text="int")

