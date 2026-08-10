# Sample test for assignment expression (walrus operator) in default parameter values (PEP 572).

# This should be a syntax error according to PEP 572.

# [DiagnosticRule.reportSyntaxError]: "Assignment expression not allowed in this context"
def func1(a=(b := 1)):
    pass

# [DiagnosticRule.reportSyntaxError]: "Assignment expression not allowed in this context"
def func2(a=1, b=(c := 2)):
    pass

# [DiagnosticRule.reportSyntaxError]: "Assignment expression not allowed in this context"
def func3(*args, a=(d := 3)):
    pass
