# This sample tests equivalent caller TypeVars with distinct TypeForm metadata.

from typing import Generic, TypeVar

T = TypeVar("T")
U = TypeVar("U")


class Domain(Generic[T]):
    one: T
    flag: bool

    def get_ring(self) -> "Ring":
        raise NotImplementedError

    def lcm(self, a: T, b: T) -> T:
        return a

    def cofactors(self, a: T, b: T) -> tuple[T, T, T]:
        return self.one, a, b


class Ring(Domain[T]):
    pass


def inner_clear(values, domain):
    common = domain.one
    for value in values:
        common = domain.lcm(common, value)
    return common, values


def clear(values, source, target=None, convert=False):
    if target is None:
        target = source.get_ring() if source.flag else source
    return inner_clear(values, target)


def original(domain: Domain[T], values: list[T]):
    source = None
    if domain.flag:
        source, domain = domain, domain.get_ring()
        common, _ = clear(values, source, domain, convert=True)
        reveal_type(common, expected_text="Unknown | T@original")
        domain.cofactors(common, common)
    else:
        common = domain.one
    if source is not None:
        reveal_type(common, expected_text="Unknown | T@original")
        result = domain.cofactors(common, common)
        reveal_type(result, expected_text="tuple[T@original, T@original, T@original] | tuple[Unknown, Unknown, Unknown]")


def direct(domain: Domain[T], value: T) -> tuple[T, T, T]:
    result = domain.cofactors(value, value)
    reveal_type(result, expected_text="tuple[T@direct, T@direct, T@direct]")
    return result


def unrelated(domain: Domain[T], value: U) -> U:
    # This should generate two errors because U is not the domain's T.
    domain.cofactors(value, value)
    return value


def concrete_negative(domain: Domain[int], value: str) -> None:
    # This should generate two errors because str is not int.
    domain.cofactors(value, value)
