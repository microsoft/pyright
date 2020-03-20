/// <reference path="fourslash.ts" />
// @asynctest: true

// @filename: quickActionOrganizeImportTest2.py
//// import time
//// import sys
//// a = 100
//// print(a)
//// import math
//// import os

helper.verifyCommand(
    {
        title: 'Quick action order imports',
        command: Consts.Commands.orderImports,
        arguments: ['quickActionOrganizeImportTest2.py']
    },
    {
        ['quickActionOrganizeImportTest2.py']: `import math
import os
import sys
import time`
    }
);
