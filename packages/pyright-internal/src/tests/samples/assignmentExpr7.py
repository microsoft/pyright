# This sample tests assignment expressions used within arguments

import collections


class NearestKeyDict(collections.UserDict):
    def method1(self, key):
        a = len(keys := [k for k in sorted(self.data) if k >= key])

        # This should generate an error because walrus operators
        # are not allowed with named arguments.
        b = list(iterable = keys := [k for k in sorted(self.data) if k >= key])
