# This sample tests a case that resulted in a false positive in the past.

# pyright: strict

import operator

keys = ("+", "-")
values = (operator.pos, operator.neg)
mapping = dict(zip(keys, values))
