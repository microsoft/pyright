# This sample tests basic template string type functionality.


# This should result in an error because x is not defined.
t1 = t"Hello {x=}"

age = 30
t2 = t'''Age = {age}'''
reveal_type(t2, expected_text="Template")

t3 = Tr""
reveal_type(t3, expected_text="Template")

t4 = "" tR"" T"" r"" RT"""{age}""" """x"""
reveal_type(t4, expected_text="Template")

t4.strings
t4.interpolations
t4.values

