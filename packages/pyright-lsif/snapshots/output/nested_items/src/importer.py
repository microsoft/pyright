from foo.bar import InitClass
#                   ^^^^^^^^^ reference lsif-pyright pypi src.importer 0.0 src/foo/bar/InitClass#
from foo.bar.baz.mod import SuchNestedMuchWow
#                           ^^^^^^^^^^^^^^^^^ reference lsif-pyright pypi src.importer 0.0 src/foo/bar/baz/mod/SuchNestedMuchWow#

print(SuchNestedMuchWow().class_item)
#^^^^ reference lsif-pyright pypi python 3.9 builtins#print.
#     ^^^^^^^^^^^^^^^^^ reference lsif-pyright pypi src.importer 0.0 src/foo/bar/baz/mod/SuchNestedMuchWow#
#                         ^^^^^^^^^^ reference lsif-pyright pypi src.importer 0.0 SuchNestedMuchWow#class_item.
print(InitClass().init_item)
#^^^^ reference lsif-pyright pypi python 3.9 builtins#print.
#     ^^^^^^^^^ reference lsif-pyright pypi src.importer 0.0 src/foo/bar/InitClass#
#                 ^^^^^^^^^ reference lsif-pyright pypi src.importer 0.0 InitClass#init_item.

