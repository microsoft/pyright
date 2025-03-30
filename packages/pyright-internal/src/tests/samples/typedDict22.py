# This sample tests that class variables for TypedDict are accessible.

from typing import TypedDict


class TD1(TypedDict): ...


reveal_type(TD1.__required_keys__, expected_text="frozenset[str]")
reveal_type(TD1.__optional_keys__, expected_text="frozenset[str]")
reveal_type(TD1.__total__, expected_text="bool")
