#!/bin/bash
cd /home/z/my-project
exec npx next dev -p 3000 2>&1 | tee /home/z/my-project/dev.log
