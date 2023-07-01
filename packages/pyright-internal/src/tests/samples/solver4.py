# This sample validates that the type checker properly
# specializes a type for an unbound method (in this case,
# the "keys" method on "dict") based on the provided "self"
# argument.

v1: dict[str, str] = {}

# This should not result in an "Unknown", so no
# error should be generated.
result = dict.keys(v1)
reveal_type(result, expected_text="dict_keys[Unknown, Unknown]")
