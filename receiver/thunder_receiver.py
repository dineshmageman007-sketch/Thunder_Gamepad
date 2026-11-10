"""Thunder Gamepad receiver, console version (dev/debug). Normal users run ThunderGamepad.exe (gui.py)."""
import argparse, asyncio
import core

ap = argparse.ArgumentParser(description="Thunder Gamepad receiver (console)")
ap.add_argument("--port", type=int, default=8766)
ap.add_argument("--code", default="", help="dev only: accept a phone that sends this code without asking")
ap.add_argument("--allow-all", action="store_true", help="dev only: pair every new phone automatically (normally you click Allow in the PC window: http://127.0.0.1:8766/ui)")
ap.add_argument("--pad", choices=["xbox", "ds4", "none", ""], default="")
a = ap.parse_args()
core.ARGS.port, core.ARGS.code, core.ARGS.pad, core.ARGS.allow_all = a.port, a.code, a.pad, a.allow_all
core.CONSOLE = True
try:
    asyncio.run(core.serve())
except KeyboardInterrupt:
    core.panic()
