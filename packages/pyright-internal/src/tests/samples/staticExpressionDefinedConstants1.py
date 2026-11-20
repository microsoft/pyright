MODE: str = "hi!"


class Config:
    MODE: str = "hi!"


config = Config()


def bytes_equal_left() -> int:
    if b"hi!" == MODE:
        return "unreachable"
    return "reachable"


def bytes_equal_right() -> int:
    if MODE == b"hi!":
        return "unreachable"
    return "reachable"


def bytes_not_equal_left() -> int:
    if b"hi!" != MODE:
        return "reachable"
    return "unreachable"


def bytes_not_equal_right() -> int:
    if MODE != b"hi!":
        return "reachable"
    return "unreachable"


def bytes_member() -> int:
    if b"hi!" != config.MODE:
        return "reachable"
    return "unreachable"


def formatted_equal_left(value: str) -> int:
    if f"{value}" == MODE:
        return "reachable"
    return "also reachable"


def formatted_equal_right(value: str) -> int:
    if MODE == f"{value}":
        return "reachable"
    return "also reachable"


def formatted_not_equal_left(value: str) -> int:
    if f"{value}" != MODE:
        return "reachable"
    return "also reachable"


def formatted_not_equal_right(value: str) -> int:
    if MODE != f"{value}":
        return "reachable"
    return "also reachable"


def formatted_constant() -> int:
    if f"{'hi!'}" == MODE:
        return "reachable"
    return 0


def formatted_concatenated(value: str) -> int:
    if "hi" f"{value}" == MODE:
        return "reachable"
    return "also reachable"


def formatted_member(value: str) -> int:
    if config.MODE == f"{value}":
        return "reachable"
    return "also reachable"


def ordinary_equal() -> int:
    if MODE == "hi!":
        return 0
    return "unreachable"


def ordinary_concatenated() -> int:
    if "hi" "!" == MODE:
        return 0
    return "unreachable"


def ordinary_unequal() -> int:
    if "other" == config.MODE:
        return "unreachable"
    return 0


def takes_int(value: int) -> None:
    pass


def expression_types(value: str) -> None:
    formatted_eq = 1 if f"{value}" == MODE else "fallback"
    reveal_type(formatted_eq, expected_text="Literal[1, 'fallback']")
    formatted_ne = 1 if MODE != f"{value}" else "fallback"
    reveal_type(formatted_ne, expected_text="Literal[1, 'fallback']")
    takes_int(formatted_ne)
    bytes_ne = 1 if b"hi!" != MODE else "fallback"
    reveal_type(bytes_ne, expected_text="Literal[1]")
    ordinary = 1 if "hi" "!" == MODE else "fallback"
    reveal_type(ordinary, expected_text="Literal[1]")
