# This sample tests Python 3.15 frozendict variance and standard library operations.

from collections import defaultdict
from collections.abc import Mapping, MutableMapping
from typing import assert_type


def accept_objects(value: Mapping[str, object]) -> None:
    pass


def require_dict(value: dict[str, int]) -> None:
    pass


mutable: dict[str, int] = {"answer": 42}
frozen: frozendict[str, int] = frozendict(mutable)

accept_objects(mutable)
accept_objects(frozen)
widened_frozen: frozendict[str, int | None] = frozen
widened_mapping: Mapping[str, int | None] = frozen

bad_keys: frozendict[object, int] = frozen  # This should generate an error
bad_dict: dict[str, int] = frozen  # This should generate an error
bad_mutable: MutableMapping[str, int] = frozen  # This should generate an error
require_dict(frozen)  # This should generate an error

defaults: defaultdict[str, int] = defaultdict(int)
assert_type(defaults | frozen, defaultdict[str, int])
