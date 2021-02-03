# This sample tests a try statement with no except clauses
# but a finally clause.

from typing import Any
import asyncio


class MyJob:
    async def do_stuff(self):
        try:
            while True:
                await asyncio.sleep(1)
                my_var = 3
        finally:
            # This should generate an error because
            # my_var may be unbound at this point.
            print(my_var)
            self.cleanup()

    def cleanup(self):
        pass


async def main():
    c = asyncio.create_task(MyJob().do_stuff())
    await asyncio.sleep(5)
    c.cancel()


asyncio.run(main())
