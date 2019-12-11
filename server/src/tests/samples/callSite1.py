# This sample tests pyright's ability to perform return type
# analysis of functions based on call-site arguments.

# This function has no type annotations
def add(a, b):
    return a + b

