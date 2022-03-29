from foo.bar import InitClass
#                   ^^^^^^^^^ reference  src/importer 0.0 `src.foo.bar`/
from foo.bar.baz.mod import SuchNestedMuchWow
#                           ^^^^^^^^^^^^^^^^^ reference  src/importer 0.0 `src.foo.bar.baz.mod`/

print(SuchNestedMuchWow().class_item)
#     ^^^^^^^^^^^^^^^^^ reference  src/importer 0.0 `src.foo.bar.baz.mod`/
#                         ^^^^^^^^^^ reference  src/foo.bar.baz.mod 0.1 SuchNestedMuchWow#class_item.
print(InitClass().init_item)
#     ^^^^^^^^^ reference  src/importer 0.0 `src.foo.bar`/
#                 ^^^^^^^^^ reference  src/foo.bar 0.1 InitClass#init_item.

