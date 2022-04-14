from foo.bar import InitClass
#                   ^^^^^^^^^ reference  snapshot-util 0.1 `src.foo.bar`/InitClass#
from foo.bar.baz.mod import SuchNestedMuchWow
#                           ^^^^^^^^^^^^^^^^^ reference  snapshot-util 0.1 `src.foo.bar.baz.mod`/SuchNestedMuchWow#

print(SuchNestedMuchWow().class_item)
#^^^^ reference  python-stdlib 3.10 builtins/print().
#     ^^^^^^^^^^^^^^^^^ reference  snapshot-util 0.1 `src.foo.bar.baz.mod`/SuchNestedMuchWow#
#                         ^^^^^^^^^^ reference  snapshot-util 0.1 `src.foo.bar.baz.mod`/SuchNestedMuchWow#class_item.
print(InitClass().init_item)
#^^^^ reference  python-stdlib 3.10 builtins/print().
#     ^^^^^^^^^ reference  snapshot-util 0.1 `src.foo.bar`/InitClass#
#                 ^^^^^^^^^ reference  snapshot-util 0.1 `src.foo.bar`/InitClass#init_item.

