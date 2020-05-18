# This sample tests a particularly difficult set of dependent
# assignments that involve tuple packing and unpacking.

# pyright: strict

v1 = ""
v3 = ""

v2, _ = v1, v3
v4 = v2
for _ in range(1):
    v1 = v4
    v2, v3 = v1, ""
