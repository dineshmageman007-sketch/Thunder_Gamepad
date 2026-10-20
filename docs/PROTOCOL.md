# Thunder Gamepad wire protocol (phone -> laptop), JSON text frames over ws://HOST:PORT/ws

First frame from phone: `{"t":"hello","token":"<key or empty>","pad":"xbox|ds4|none","name":"Pixel 8"}` (older builds / the Kotlin fallback send the key in a `code` field; the PC accepts both).

Pairing (no typed code):
- Known `token` -> `{"t":"welcome","pad":..,"padError":..,"host":..,"pcid":"..","os":..}` straight away.
- Unknown/empty token -> `{"t":"pending","secs":30}`; the PC window shows **Allow / Block**.
  - Allow -> `{"t":"paired","token":"<32 hex>"}` then `welcome`. The phone stores the token per `pcid` (id of the PC, survives IP changes) and sends it from then on.
  - Block / no answer / another request already pending -> `{"t":"denied","reason":"blocked|timeout|busy|locked|gone","locked":SECONDS}` then close. After 3 declined requests from one IP the receiver ignores it for 60 s (`reason:"locked"`).
- Tokens live on the PC in `~/.thunder_gamepad_devices.json` (`{"pcid":..,"phones":{token:{name,ip,added,last}}}`); "Remove" in the PC window deletes one and disconnects that phone.
- Dev only: console `--allow-all` pairs everyone, `--code X` accepts a phone that sends token/code X.

After that (phone -> laptop), all LOW-LEVEL; the laptop holds no layout/macro logic:
| frame | meaning |
|---|---|
| `{"t":"pad","n":"A","d":1}` | pad button down/up (A B X Y LB RB LT RT START BACK GUIDE LS RS UP DOWN LEFT RIGHT TOUCHPAD) |
| `{"t":"trig","side":"L|R","v":0..1}` | analog trigger |
| `{"t":"stick","side":"l|r","x":-1..1,"y":-1..1}` | analog stick |
| `{"t":"key","k":"ctrl","d":1}` | keyboard key (pynput names, f1-f24, num0-9, `vk:0x41`) |
| `{"t":"mbtn","n":"left|right|middle|x1|x2","d":1}` | mouse button |
| `{"t":"mmove","dx":5,"dy":-3}` | relative mouse move (SendInput). **Sent once per touch sample, immediately, so it can arrive hundreds of times per second. The receiver must apply every frame at once: no coalescing, throttling or queueing** (see Transport contract) |
| `{"t":"mto","x":0.5,"y":0.5}` | jump cursor to fraction of screen |
| `{"t":"scroll","v":1,"h":0}` | wheel |
| `{"t":"type","back":N,"s":"text"}` | N backspaces then type text. Windows: each character is sent as a real key press (VkKeyScanW -> virtual key + scan code, with Shift/Ctrl/Alt when needed; Enter/Tab handled); characters the keyboard layout cannot produce fall back to pynput |
| `{"t":"axes0"}` / `{"t":"reset"}` | zero axes / release everything (panic) |
| `{"t":"setpad","kind":"xbox|ds4|none"}` | switch virtual controller (answered by a new `welcome`) |
| `{"t":"ping","ts":123}` | answered `{"t":"pong","ts":123}`; the phone pings every 2 s (round-trip time shown in the in-game pill) |

Laptop -> phone extras: `{"t":"rumble","l":0-255,"s":0-255}`.
Discovery: UDP broadcast `PADLINK?` to port 8767 -> reply `{"t":"padlink","name","port","pad","pcid"}` (the phone re-finds a remembered PC by `pcid` if its IP changed).
If the connection drops the receiver releases every key/button/axis that phone was holding.

## Transport contract (why the camera feels like the old v3)
- The phone **page itself** opens the WebSocket (direct, same as the old v3). The Kotlin/OkHttp route is an optional "Compatibility mode" (Settings, OFF by default) that sends the same frames.
- The phone sends frames **as the input happens**: one `mmove` per touch sample (`pointerrawupdate`), no per-frame batching, no merging while busy, no Wi-Fi/priority tricks. The phone only asks Android for the fastest screen refresh mode and keeps the page drawing at full rate while playing.
- The receiver is a pure receiver: parse -> apply (SendInput / ViGEm / pynput) -> done. TCP_NODELAY is on (aiohttp default). No process-priority or timer-resolution changes, no per-message logging, no work before `handle()`. Slow jobs (driver install, firewall rules, status API) run off the input path.
- Layout/macro logic never reaches the PC: the phone expands every action into the low-level frames above and releases everything it holds on disconnect (the PC also releases everything that phone was holding if the socket drops).
