# This sample tests a code flow graph that includes a nested loop
# and a variable that is assigned only in the outer loop.


# pyright: strict


# * Code flow graph for func1:
# Assign[step+=1] ── True[step==0] ── Assign[_=] ── Loop ┬─ Loop ┬─ Assign[step=1] ── Start
#                                                        │       ╰ Circular(Assign[step+=1])
#                                                        ╰ FalseNever ─ False ─ Circular(Assign[_])
def func1():
    step = 1
    while True:
        for _ in [1]:
            if step == 0:
                step += 1
                break
        else:
            return


