# This sample tests invalidation of tuple length narrowing for attributes
# across calls that can mutate the object.

from typing import Literal


class TupleContainer:
    values: tuple[int, ...]

    def __init__(self, values: tuple[int, ...]) -> None:
        self.values = values

    def shorten(self) -> None:
        self.values = self.values[:-1]

    def test_self_method(self) -> None:
        assert len(self.values) == 5
        reveal_type(
            self.values, expected_text="tuple[int, int, int, int, int]"
        )

        self.shorten()
        reveal_type(self.values, expected_text="tuple[int, ...]")

        assert len(self.values) == 4
        reveal_type(self.values, expected_text="tuple[int, int, int, int]")


def shorten(container: TupleContainer) -> None:
    container.values = container.values[:-1]


def consume_tuple(values: tuple[int, ...]) -> None:
    pass


def unrelated_call() -> None:
    pass


def test_external_call(container: TupleContainer) -> None:
    assert len(container.values) == 5
    shorten(container)
    reveal_type(container.values, expected_text="tuple[int, ...]")

    assert len(container.values) == 4
    reveal_type(container.values, expected_text="tuple[int, int, int, int]")


def test_alias(container: TupleContainer) -> None:
    alias = container
    assert len(container.values) == 5

    alias.shorten()
    reveal_type(container.values, expected_text="tuple[int, ...]")

    assert len(container.values) == 4
    reveal_type(container.values, expected_text="tuple[int, int, int, int]")


def test_alias_across_branch(
    container: TupleContainer, condition: bool
) -> None:
    alias = container
    assert len(container.values) == 5

    if condition:
        pass

    alias.shorten()
    reveal_type(container.values, expected_text="tuple[int, ...]")


def test_possible_alias_across_branch(
    container: TupleContainer,
    other: TupleContainer,
    condition: bool,
) -> None:
    alias = container
    if condition:
        alias = other

    assert len(container.values) == 5
    alias.shorten()
    reveal_type(container.values, expected_text="tuple[int, ...]")


def test_unrelated_aliases_across_branch(
    container: TupleContainer,
    other1: TupleContainer,
    other2: TupleContainer,
    condition: bool,
) -> None:
    if condition:
        alias = other1
    else:
        alias = other2

    assert len(container.values) == 5
    alias.shorten()
    reveal_type(
        container.values, expected_text="tuple[int, int, int, int, int]"
    )


def test_alias_across_many_branches(
    container: TupleContainer, conditions: tuple[bool, ...]
) -> None:
    alias = container
    assert len(container.values) == 5

    if conditions[0]:
        pass
    if conditions[1]:
        pass
    if conditions[2]:
        pass
    if conditions[3]:
        pass
    if conditions[4]:
        pass
    if conditions[5]:
        pass
    if conditions[6]:
        pass
    if conditions[7]:
        pass
    if conditions[8]:
        pass
    if conditions[9]:
        pass
    if conditions[10]:
        pass
    if conditions[11]:
        pass

    alias.shorten()
    reveal_type(container.values, expected_text="tuple[int, ...]")


def test_alias_in_loop(
    container: TupleContainer, condition: bool
) -> None:
    alias = container

    while condition:
        assert len(container.values) == 5
        alias.shorten()
        reveal_type(container.values, expected_text="tuple[int, ...]")

        assert len(container.values) == 4
        reveal_type(
            container.values, expected_text="tuple[int, int, int, int]"
        )
        condition = False


def test_local_variable(container: TupleContainer) -> None:
    values = container.values
    assert len(values) == 5

    shorten(container)
    reveal_type(values, expected_text="tuple[int, int, int, int, int]")


def test_direct_assignment(container: TupleContainer) -> None:
    assert len(container.values) == 5
    container.values = container.values[:-1]

    assert len(container.values) == 4
    reveal_type(container.values, expected_text="tuple[int, int, int, int]")


def test_unrelated_calls(
    container: TupleContainer, other: TupleContainer
) -> None:
    assert len(container.values) == 5

    unrelated_call()
    consume_tuple(container.values)
    other.shorten()
    reveal_type(
        container.values, expected_text="tuple[int, int, int, int, int]"
    )


class PropertyContainer:
    _values: tuple[int, ...]

    def __init__(self, values: tuple[int, ...]) -> None:
        self._values = values

    @property
    def values(self) -> tuple[int, ...]:
        return self._values


def mutate_property_container(container: PropertyContainer) -> None:
    container._values = container._values[:-1]


def test_property(container: PropertyContainer) -> None:
    assert len(container.values) == 5

    unrelated_call()
    consume_tuple(container.values)
    reveal_type(
        container.values, expected_text="tuple[int, int, int, int, int]"
    )

    mutate_property_container(container)
    reveal_type(container.values, expected_text="tuple[int, ...]")

    assert len(container.values) == 4
    reveal_type(container.values, expected_text="tuple[int, int, int, int]")


class TaggedTupleContainer:
    value: tuple[Literal["a"], int] | tuple[Literal["b"], str]


def inspect_tagged_tuple(container: TaggedTupleContainer) -> None:
    pass


def test_element_narrowing(container: TaggedTupleContainer) -> None:
    if container.value[0] == "a":
        inspect_tagged_tuple(container)
        reveal_type(
            container.value, expected_text="tuple[Literal['a'], int]"
        )
