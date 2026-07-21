# Secrets removed from this repo

No credential values are stored here. Each entry below names *where* a secret was and what it
did — never the value.

| File | Directive | Purpose |
|---|---|---|
| `unrealircd/conf/opers.conf` | `password` | IRC operator login (argon2id hash) |
| `unrealircd/conf/unrealircd.conf` | `password` ×7 | oper block, bot-manager account, Anope uplink, and 4 server-link passwords |
| `unrealircd/conf/unrealircd.conf` | `cloak-keys` ×3 | host-cloaking keys — **network-wide, all linked servers must share these** |
| `services/conf/services.conf` | `password` / `sendpass` / `recvpass` ×5 | Anope uplink to the IRCd, OperServ login |
| `systemd/microsocks.service` | `-u` / `-P` | SOCKS5 proxy username and password |
| `bots/tor_bots.py` | `OPER_PASS` | IRC oper password used by the bot manager — same value as the bot-manager account in `unrealircd.conf` |
| *(not in repo)* | `unrealircd/conf/tls/server.key.pem` | IRCd TLS private key |

## Recovering them

Two sources, in order of preference:

1. **Azure disk snapshot** — `irc-hub-wus2-osdisk-snap-20260721` in RG `MANCOM`. Full-fidelity
   copy of the OS disk as it was at decommission, including the TLS private key. Attach it to a
   temporary VM to read.
2. **Local unredacted archive** — `.secrets/irc-hub-wus2-full-20260721.tgz` on the ManCom AI box
   (`admin-ai-mc`), gitignored, mode 600.

## If rebuilding

The cloak keys are the one item that cannot be regenerated freely — changing them changes every
user's cloaked hostname across the network, and every linked server must be updated in lockstep.
Everything else can and arguably should be rotated on rebuild, since these values sat on a host
with an internet-facing SOCKS proxy.
