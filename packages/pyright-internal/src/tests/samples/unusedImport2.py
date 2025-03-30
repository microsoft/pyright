# This sample tests the reportUnusedImport diagnostic rule
# for multipart imports.

# This should result in an error if reportUnusedImport is enabled.
import package2.module1

# This should result in an error if reportUnusedImport is enabled.
import package2.module2

import package2.module3

import package2.module2 as dummy


def func1():
    print(package2.module3.a3)
    print(dummy)
