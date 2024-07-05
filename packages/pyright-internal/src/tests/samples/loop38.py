# This sample tests a code flow graph that includes a nested loop
# and a variable that is assigned only in the outer loop.


# pyright: strict


# * Code flow graph for func1:
# Assign[step+=1] ── True[step==0] ── Assign[node=] ── Loop ┬─ Loop ┬─ Assign[step=1] ── Start
#                                                           │       ╰ Circular(Assign[step+=1])
#                                                           ╰ FalseNever ─ False ─ Circular(Assign[node])
def func1(nodes: list[int]):
    step = 1
    while True:
        for node in nodes:
            if node or step == 0:
                step += 1
                break
        else:
            return
