# This sample tests type checking for match statements (as
# described in PEP 634) that contain literal patterns.

from typing import Literal

def test_unknown(value_to_match):
    match value_to_match:
        case 3 as a1, -3 as a2:
            t_a1: Literal["Literal[3]"] = reveal_type(a1)
            t_a2: Literal["Literal[-3]"] = reveal_type(a2)
            t_v1: Literal["Unknown"] = reveal_type(value_to_match)

        case 3j as b1, -3 + 5j as b2:
            t_b1: Literal["complex"] = reveal_type(b1)
            t_b2: Literal["complex"] = reveal_type(b2)
            t_v2: Literal["Unknown"] = reveal_type(value_to_match)

        case "hi" as c1, None as c2:
            t_c1: Literal["Literal['hi']"] = reveal_type(c1)
            t_c2: Literal["None"] = reveal_type(c2)
            t_v3: Literal["Unknown"] = reveal_type(value_to_match)

        case True as d1, False as d2:
            t_d1: Literal["Literal[True]"] = reveal_type(d1)
            t_d2: Literal["Literal[False]"] = reveal_type(d2)
            t_v4: Literal["Unknown"] = reveal_type(value_to_match)

def test_tuple(value_to_match: tuple[int | float | str | complex, ...]):
    match value_to_match:
        case (3, -3) as a1:
            t_a1: Literal["tuple[Literal[3], Literal[-3]]"] = reveal_type(a1)
            t_v1: Literal["tuple[Literal[3], Literal[-3]]"] = reveal_type(value_to_match)

        case (3j , -3 + 5j) as b1:
            t_b1: Literal["tuple[complex, complex]"] = reveal_type(b1)
            t_v2: Literal["tuple[complex, complex]"] = reveal_type(value_to_match)


def test_union(value_to_match: int | float | str | complex | bool | None):
    match value_to_match:
        case (3 | -3j) as a1:
            t_a1: Literal["complex | Literal[3]"] = reveal_type(a1)
            t_v1: Literal["complex | Literal[3]"] = reveal_type(value_to_match)

        case (True | False | 3.4 | -3 + 3j | None) as b1:
            t_b1: Literal["float | complex | bool | None"] = reveal_type(b1)
            t_v2: Literal["float | complex | bool | None"] = reveal_type(value_to_match)

        case ("hi" | 3.4) as c1:
            t_c1: Literal["float | Literal['hi']"] = reveal_type(c1)
            t_v3: Literal["float | Literal['hi']"] = reveal_type(value_to_match)

        case ((True | "True") as d1) | ((False | "False") as d1):
            t_d1: Literal["bool | Literal['True', 'False']"] = reveal_type(d1)
            t_v4: Literal["bool | Literal['True', 'False']"] = reveal_type(value_to_match)


