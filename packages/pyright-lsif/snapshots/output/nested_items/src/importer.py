from foo.bar import InitClass
#                   ^^^^^^^^^ reference  src/foo.bar unknown InitClass#
from foo.bar.baz.mod import SuchNestedMuchWow
#                           ^^^^^^^^^^^^^^^^^ reference  src/foo.bar.baz.mod unknown SuchNestedMuchWow#

print(SuchNestedMuchWow().class_item)
#^^^^ reference  builtins 3.9 print().
#     ^^^^^^^^^^^^^^^^^ reference  src/foo.bar.baz.mod unknown SuchNestedMuchWow#
#                         ^^^^^^^^^^ reference  src/foo.bar.baz.mod unknown SuchNestedMuchWow#class_item.
print(InitClass().init_item)
#^^^^ reference  builtins 3.9 print().
#     ^^^^^^^^^ reference  src/foo.bar unknown InitClass#
#                 ^^^^^^^^^ reference  src/foo.bar unknown InitClass#init_item.

