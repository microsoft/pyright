# This sample tests f-strings where expressions contain
# other string literals.

a1 = f"[{{name}}{'}' if True else ''}]"

b1 = f"{'''hello'''}"

c1 = f"""{"\""}"""

hello = 3
d1 = f"{ f'{hello}' }"

print(f"{'a' if 'b' != 'c' else 'd'}")


a2 = fr"[{{name}}{'}' if True else ''}]"

b2 = fr"{'''hello'''}"

c2 = fr"""{"\""}"""

hello = 3
d2 = fr"{ f'{hello}' }"

