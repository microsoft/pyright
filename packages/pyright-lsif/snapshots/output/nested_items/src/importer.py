from foo.bar import InitClass
#                   ^^^^^^^^^ reference  src/foo.bar test InitClass#
from foo.bar.baz.mod import SuchNestedMuchWow
#                           ^^^^^^^^^^^^^^^^^ reference  src/foo.bar.baz.mod test SuchNestedMuchWow#

print(SuchNestedMuchWow().class_item)
#^^^^ reference  builtins 3.9 print().
#     ^^^^^^^^^^^^^^^^^ reference  src/foo.bar.baz.mod test SuchNestedMuchWow#
#                         ^^^^^^^^^^ reference  src/foo.bar.baz.mod test SuchNestedMuchWow#class_item.
print(InitClass().init_item)
#^^^^ reference  builtins 3.9 print().
#     ^^^^^^^^^ reference  src/foo.bar test InitClass#
#                 ^^^^^^^^^ reference  src/foo.bar test InitClass#init_item.

