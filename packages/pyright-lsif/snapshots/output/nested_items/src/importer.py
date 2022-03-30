from foo.bar import InitClass
#                   ^^^^^^^^^ reference  src/foo.bar 0.1 InitClass#
from foo.bar.baz.mod import SuchNestedMuchWow
#                           ^^^^^^^^^^^^^^^^^ reference  src/foo.bar.baz.mod 0.1 SuchNestedMuchWow#

print(SuchNestedMuchWow().class_item)
#     ^^^^^^^^^^^^^^^^^ reference  src/foo.bar.baz.mod 0.1 SuchNestedMuchWow#
#                         ^^^^^^^^^^ reference  src/foo.bar.baz.mod 0.1 SuchNestedMuchWow#class_item.
print(InitClass().init_item)
#     ^^^^^^^^^ reference  src/foo.bar 0.1 InitClass#
#                 ^^^^^^^^^ reference  src/foo.bar 0.1 InitClass#init_item.

