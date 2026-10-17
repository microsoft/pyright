# This sample tests flow-scoped presence checks without key/value correlations.

from typing import Literal, TypedDict, TypeVar, assert_type


class Data(TypedDict, total=False):
    a: int
    b: str


Key = Literal["a", "b"]


def guarded_loop(data: Data):
    for key in ("a", "b"):
        if key in data:
            value = data[key]
            assert_type(value, int | str)


def negative_guard(data: Data, key: Key):
    if key not in data:
        return
    assert_type(data[key], int | str)


def asserted_guard(data: Data, key: Key):
    assert key in data
    assert_type(data[key], int | str)


def boolean_guards(data: Data, key: Key, flag: bool):
    if flag and key in data:
        value1 = data[key]
    else:
        value1 = None
    value2 = data[key] if key in data else None
    assert_type(value1, int | str | None)
    assert_type(value2, int | str | None)


def nested_guards(data: Data, outer: Key, inner: Key):
    if outer in data:
        if inner in data:
            first = data[inner]
            second = data[outer]
            assert_type(first, int | str)
            assert_type(second, int | str)


def branch_join(data: Data, key: Key, flag: bool):
    if flag:
        if key not in data:
            return
    else:
        assert key in data
    assert_type(data[key], int | str)


def unrelated_assignment(data: Data, key: Key, flag: bool):
    if key in data:
        if flag:
            other = 1
        else:
            other = 2
        value = data[key]
        assert_type(value, int | str)
        assert_type(other, Literal[1, 2])


class Holder:
    data: Data
    key: Key

    def read(self):
        if self.key in self.data:
            assert_type(self.data[self.key], int | str)


class Nested(TypedDict):
    data: Data


def nested_reference(container: Nested, key: Key):
    if key in container["data"]:
        assert_type(container["data"][key], int | str)


def comprehensions(data: Data):
    values = [data[key] for key in ("a", "b") if key in data]
    assert_type(values, list[int | str])


class SameValues(TypedDict, total=False):
    a: int
    b: int


def same_values(data: SameValues, key: Key):
    if key in data:
        assert_type(data[key], int)


class OtherData(TypedDict, total=False):
    a: bytes
    b: float


def shared_keys(data: Data | OtherData, key: Key):
    if key in data:
        assert_type(data[key], int | str | bytes | float)


def replaced_key(data: Data, key: Key, other: Key):
    if key in data:
        key = other
        # This should generate an error: the new key was not checked.
        data[key]


def replaced_data(data: Data, key: Key):
    if key in data:
        data = {}
        # This should generate an error: the new dictionary was not checked.
        data[key]


def replaced_member(holder: Holder, key: Key):
    if key in holder.data:
        holder.data = {}
        # This should generate an error.
        holder.data[key]


def absent_key(data: Data, key: Key):
    if key not in data:
        # This should generate an error.
        data[key]


def incomplete_guard(data: Data, key: Key, flag: bool):
    if flag or key in data:
        # This should generate an error: only one branch checks the key.
        data[key]


def partial_join(data: Data, key: Key, flag: bool):
    if key in data:
        if flag:
            data = {}
        # This should generate an error.
        data[key]


def deleted_literal(data: Data, key: Key):
    if key in data:
        del data["a"]
        # This should generate an error.
        data[key]


def deleted_variable(data: Data, key: Key):
    if key in data:
        del data[key]
        # This should generate an error.
        data[key]


def deleted_alias(data: Data, key: Key):
    alias = data
    if key in data:
        del alias[key]
        # This should generate an error.
        data[key]


def remove_keys(data: Data):
    del data["a"]
    del data["b"]


def called_mutator(data: Data, key: Key):
    if key in data:
        remove_keys(data)
        # This should generate an error.
        data[key]


def loop_boundary(data: Data, key: Key, flag: bool):
    if key in data:
        while flag:
            # This should generate an error: a previous iteration can delete it.
            data[key]
            del data[key]


def closure(data: Data, key: Key):
    if key in data:
        def read():
            # This should generate an error: the guard can be stale when called.
            return data[key]
        return read


def shadowed_key(data: Data, key: Key):
    if key in data:
        # This should generate an error: the comprehension binds another key.
        values = [data[key] for key in ("a", "b")]
        return values


class RequiredData(TypedDict):
    a: int
    b: str


def loop_carried_value(data: RequiredData):
    previous = 0
    for key in ("a", "b"):
        if key in data:
            # This should generate an error: previous can come from another key.
            data[key] = previous
            previous = data[key]


def select(data: RequiredData, key: Key):
    if key in data:
        return data, key, data[key]
    raise KeyError(key)


def independent_calls(data: RequiredData):
    _, _, first_value = select(data, "a")
    second, second_key, _ = select(data, "b")
    # This should generate an error: separate calls need not select the same key.
    second[second_key] = first_value


T = TypeVar("T", int, str)


def add(left: T, right: T) -> T:
    return left + right


def generic_call(data: RequiredData, key: Key):
    if key in data:
        # This should generate an error: str and int cannot share this constraint.
        add(data[key], 1)


def inferred_read(data: RequiredData, key: Key):
    if key in data:
        return data[key]
    raise KeyError(key)


def independent_results(data: RequiredData):
    first = inferred_read(data, "a")
    second = inferred_read(data, "b")
    assert_type(first, int | str)
    assert_type(second, int | str)
    # This should generate an error: these results are independent unions.
    _ = first + second


def indirect_delete(data: Data, key: Key, index: int):
    aliases = [data]
    if key in data:
        del aliases[index][key]
        # This should generate an error.
        data[key]


def indirect_replace(container: Nested, key: Key, slot: Literal["data"]):
    if key in container["data"]:
        container[slot] = {}
        # This should generate an error.
        container["data"][key]


def aliased_member(holder: Holder, key: Key):
    alias = holder
    if key in holder.data:
        alias.data = {}
        # This should generate an error.
        holder.data[key]


def walrus_guard(data: Data, key: Key):
    if (current := key) in data:
        assert_type(data[current], int | str)


def negated_guard(data: Data, key: Key):
    if not (key not in data):
        assert_type(data[key], int | str)


class JsonSchema(TypedDict, total=False):
    anyOf: list["JsonSchema"]
    oneOf: list["JsonSchema"]


def process_schema(schema: JsonSchema):
    for keyword in ("anyOf", "oneOf"):
        if keyword in schema:
            reveal_type(keyword, expected_text="Literal['anyOf', 'oneOf']")
            sub_schemas = schema[keyword]
            assert_type(sub_schemas, list[JsonSchema])
            print(len(sub_schemas))


def shadowed_reveal(data: Data, key: Key):
    def reveal_type(value: Key):
        remove_keys(data)

    if key in data:
        reveal_type(key)
        # This should generate an error: this is not the checker intrinsic.
        data[key]
