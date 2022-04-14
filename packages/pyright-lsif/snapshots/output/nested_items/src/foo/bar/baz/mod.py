class SuchNestedMuchWow:
# definition  snapshot-util 0.1 `src.foo.bar.baz.mod`/__init__:
#     ^^^^^^^^^^^^^^^^^ definition  snapshot-util 0.1 `src.foo.bar.baz.mod`/SuchNestedMuchWow#
    class_item: int = 42
#   ^^^^^^^^^^ definition  snapshot-util 0.1 `src.foo.bar.baz.mod`/SuchNestedMuchWow#class_item.
#               ^^^ reference  python-stdlib 3.10 builtins/int#

