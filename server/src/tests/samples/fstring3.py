# This sample tests f-strings where expressions contain
# other string literals.

a = f"[{{name}}{'}' if True else ''}]"

b = f"{'''hello'''}"

c = f"""{"\""}"""

hello = 3
d = f"{ f'{hello}' }"

