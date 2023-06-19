# This sample tests for the detection of unbound or partially-unbound
# variables within loops.

import random

for a in [1, 2, 3]:
    # This should generate an error because b is unbound.
    if b == 1:
        b = 2


for a in [1, 2, 3]:
    if random.random() > 0.5:
        c = 2

    # This should generate an error because c is potentially unbound.
    print(c)

while True:
    # This should generate an error because d is unbound.
    if d == 1:
        d = 2
