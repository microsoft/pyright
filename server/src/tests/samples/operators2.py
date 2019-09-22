# This sample tests the type checker's handling of chained
# comparison operators.

from datetime import datetime

def requires_bool(val: bool):
    pass

date1 = datetime.now()
date2 = datetime.now()
date3 = datetime.now()

foo1 = date1 < date2 <= date3
requires_bool(foo1)

int1 = 3
foo2 = 2 < int1 < 5
requires_bool(foo2)

# This should generate an error because
# int and datetime cannot be compared.
foo3 = date1 < date2 < 3

