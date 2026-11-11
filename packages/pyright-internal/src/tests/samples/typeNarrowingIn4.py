from typing import Any, Literal, reveal_type


class Expr:
    def has(self, other: object) -> bool:
        return False


def any_keys(
    expr: Any,
    contractions: dict[Any, set[Expr]],
    use_contractions: bool,
    nested: bool,
):
    if use_contractions:
        dummies = contractions
    else:
        dummies = {None: (expr,)}
    for key, terms in dummies.items():
        if isinstance(key, tuple):
            for term in terms:
                if term in dummies and nested:
                    raise NotImplementedError
                else:
                    reveal_type(term, expected_text="Any | Expr")
                    term.has(expr)


def unknown_keys(
    expr: Any,
    contractions: dict,
    use_contractions: bool,
    nested: bool,
):
    if use_contractions:
        dummies = contractions
    else:
        dummies = {None: (expr,)}
    for key, terms in dummies.items():
        if isinstance(key, tuple):
            for term in terms:
                if term in dummies and nested:
                    raise NotImplementedError
                else:
                    reveal_type(term, expected_text="Any | Unknown")
                    term.has(expr)


def any_keys_reversed(
    expr: Any,
    contractions: dict[Any, set[Expr]],
    use_contractions: bool,
    nested: bool,
):
    if use_contractions:
        dummies = {None: (expr,)}
    else:
        dummies = contractions
    for key, terms in dummies.items():
        if isinstance(key, tuple):
            for term in terms:
                if term not in dummies or not nested:
                    reveal_type(term, expected_text="Any | Expr")
                    term.has(expr)
                else:
                    raise NotImplementedError


def known_optional_any(value: Any, container: list[str] | list[None]):
    if value in container:
        reveal_type(value, expected_text="Any | None")
        value.upper()


def known_optional_unknown(value, container: list[str] | list[None]):
    if value in container:
        reveal_type(value, expected_text="Unknown | None")
        value.upper()


def known_optional_single(value: Any, container: list[str | None]):
    if value in container:
        reveal_type(value, expected_text="Any | None")
        value.upper()


def explicit_optional(value: Any | None, container: list[Any] | list[None]):
    if value in container:
        reveal_type(value, expected_text="Any | None")
        value.upper()


def explicit_optional_unknown(value, enabled: bool, container: list[Any] | list[None]):
    optional = value if enabled else None
    if optional in container:
        reveal_type(optional, expected_text="Unknown | None")
        optional.upper()


def finite_literals(value: Any, container: list[Literal["x"]] | tuple[Literal["y"], None]):
    if value in container:
        reveal_type(value, expected_text="Literal['x', 'y'] | None")
        value.upper()


def none_only(value: Any, container: list[None] | tuple[None]):
    if value in container:
        reveal_type(value, expected_text="None")
        value.upper()


def known_receiver(value: int | None, container: list[int] | tuple[int]):
    if value in container:
        reveal_type(value, expected_text="int")
        value.bit_length()


def opaque_container(value: Any, container: list[Any] | list[None]):
    if value in container:
        reveal_type(value, expected_text="Any")
        value.upper()
