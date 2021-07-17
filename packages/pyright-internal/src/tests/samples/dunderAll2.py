# This sample tests the check for symbols that are present in __all__ but
# are not present in the module (reportUnsupportedDunderAll).

a = 3
b = 4
g = 4

# This should generate an error for "d"
__all__ = ["a", "b", "c", "d"]
__all__.remove("c")

# This should generate an error for "e"
__all__.append("e")

# This should generate an error for "f"
__all__ += ["f", "g"]
