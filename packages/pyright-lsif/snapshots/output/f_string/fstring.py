var = ", world!"
#^^ definition  fstring unknown var.

print(f"var: hello {var}")
#^^^^ reference  builtins 3.9 print().
#                   ^^^ reference  fstring unknown var.

