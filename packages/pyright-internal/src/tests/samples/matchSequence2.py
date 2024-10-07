# This sample tests pattern matching with tuple expansion when the number
# of expanded tuples grows very large.


class A1:
    pass


class A2:
    pass


class A3:
    pass


class A4:
    pass


class A5:
    pass


class A6:
    pass


class A7:
    pass


class A8:
    pass


class A9:
    pass


class A10:
    pass


class A11:
    pass


class A12:
    pass


class A13:
    pass


class A14:
    pass


class A15:
    pass


class A16:
    pass


class B1:
    pass


class B2:
    pass


class B3:
    pass


class B4:
    pass


class B5:
    pass


class B6:
    pass


class B7:
    pass


class B8:
    pass


class B9:
    pass


class B10:
    pass


class B11:
    pass


class B12:
    pass


class B13:
    pass


class B14:
    pass


class B15:
    pass


class B16:
    pass


type UA = (
    A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9 | A10 | A11 | A12 | A13 | A14 | A15 | A16
)

type UB = (
    B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 | B11 | B12 | B13 | B14 | B15 | B16
)


def test(a: UA, b: UB) -> bool:
    t = a, b
    match t:
        case A1(), B1():
            return True
        case A2(), B2():
            return True
        case A3(), B3():
            return True
        case A4(), B4():
            reveal_type(t, expected_text="tuple[A4, B4]")
            return True
        case A5(), B5():
            return True
        case A6(), B6():
            reveal_type(t, expected_text="tuple[A6, B6]")
            return True
        case A7(), B7():
            reveal_type(t, expected_text="tuple[A7, B7]")
            return True
        case A8(), B8():
            reveal_type(t, expected_text="tuple[A8, B8]")
            return True
        case A9(), B9():
            # The type will become less precise in this case
            # because narrowing in the negative case needs
            # to fall back on less-precise types.
            reveal_type(t, expected_text="Sequence[A9 | B9]")
            return True
        case A10(), B10():
            return True
        case A11(), B11():
            return True
        case A12(), B12():
            return True
        case A13(), B13():
            return True
        case A14(), B14():
            return True
        case A15(), B15():
            return True
        case A16(), B16():
            return True
        case _:
            reveal_type(t, expected_text="Any")
            raise ValueError()
