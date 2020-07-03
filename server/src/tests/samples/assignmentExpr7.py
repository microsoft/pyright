# This sample tests assignment expressions used within
# arguments

import collections


class NearestKeyDict(collections.UserDict):
    def _keytransform(self, key):
        a = len(candidate_keys := [k for k in sorted(self.data) if k >= key])

        # This should generate an error because walrus operators
        # are not allowed with named arguments.
        b = list(iterable = candidate_keys := [k for k in sorted(self.data) if k >= key])
