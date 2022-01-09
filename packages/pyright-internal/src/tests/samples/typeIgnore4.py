# This sample tests the reportUnnecessaryTypeIgnoreComment diagnostic check
# as applied to the entire file.

a: str = 3  # type: ignore

# This should emit an error if reportUnnecessaryTypeComment is enabled
b: str = ""  # type: ignore

# This should emit an error if reportUnnecessaryTypeComment is enabled
c: int = 3  # type: ignore
