# This sample tests type narrowing for conditional
# statements of the form X is None or X is not None
# where X is an assignment expression.

# pyright: strict

i = {"a": "", "b": None}
dict_comp = {key: w.strip() if (w := i[key]) is not None else "" for key in i}
