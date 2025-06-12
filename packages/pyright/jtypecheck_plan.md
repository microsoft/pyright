## Demand-driven (or lazy) parsing and analysis.
 key optimization strategy that type checkers like Pyright use

#### The Core Principle: Analyze Only What's Necessary

lets start with an example secnaio of our file `your_file.py`
```python
import os 

an_integer: int = 1

an_integer = os.getcwd()
```
