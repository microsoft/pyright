# This sample tests the case where the overloads have different
# parameter counts. This particular sample exposed a bug
# in pyright's logic at one point.

import subprocess


def my_method(cmd, *args, **kwargs):
    return subprocess.run(cmd, *args, **kwargs)
