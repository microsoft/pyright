# This sample tests f-strings where expressions contain
# other string literals.

# pyright: strict

a1 = f"[{{name}}{'}' if True else ''}]"

b1 = f"{'''hello'''}"

c1 = f"""{'"'}"""

hello1 = 3
d1 = f"{f'{hello1}'}"

print(f"{'a' if 'b' != d1 else 'd'}")


a2 = rf"[{{name}}{'}' if True else ''}]"

b2 = rf"{'''hello'''}"

c2 = rf"""{'"'}"""

hello2 = 3
d2 = rf"{rf'{hello2}'}"

e1 = f""" {f''' {"".join(["this", "that"])}'''}"""
