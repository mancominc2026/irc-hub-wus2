# irc-hub-wus2 — code & config archive

Preservation snapshot of the Azure VM `irc-hub-wus2` (RG `MANCOM`, sub *Microsoft Azure
Sponsorship* `2e587a77-…`, westus2), captured **2026-07-21** immediately before the VM was
decommissioned to stop its ~$25/mo draw on the Azure sponsorship credit.

This repo exists so the host can be rebuilt from scratch. It is **not** a running system and
nothing here is deployed.

## What the host was

| | |
|---|---|
| Role | IRC network hub — `hub.unifiedcore.org`, network **UnifiedCore** |
| Image | Ubuntu 24.04 LTS **arm64**, `Standard_B2pls_v2`, 30 GB OS disk |
| Created | 2026-05-13 · uptime at capture 69 days |
| Public IP | 172.171.126.159 (static, Standard SKU) · private 10.0.0.5 |
| Admin user | `irchub` |

### Services that were running

- **UnrealIRCd** — client TLS `:6697`, server-link `:7029`, localhost `:7030`
- **Anope** IRC services (`services.unifiedcore.org`)
- **microsocks** SOCKS5 proxy, bound `0.0.0.0:1080`
- **Tor**, localhost `:9050`
- **certbot** for `unifiedcore.org` / `hub.unifiedcore.org`

### Server links configured

`services.unifiedcore.org` · `usc.unifiedcore.org` · `can.unifiedcore.org` ·
`eu.unifiedcore.org` · `wsc.unifiedcore.org`

## Layout

```
bots/           6 Python IRC bot scripts (see caveat below)
unrealircd/conf/  UnrealIRCd configuration (secrets redacted)
services/conf/    Anope configuration (secrets redacted)
systemd/          unrealircd.service · anope.service · microsocks.service
letsencrypt/      certbot renewal configs
SECRETS.md        what was stripped and where to recover it
```

## Caveats on `bots/`

The six scripts in `bots/` generate synthetic IRC users — 40 connections apiece with randomised
nicks, routed through SOCKS/Tor, with an oper bot assigning `.onion` vhosts so the sessions
present as independent Tor users. Four of them (`efnet_bots.py`, `pureirc_bots.py`,
`abjects_bots.py`, `sob-user-bots_tor_fixed.py`) target **third-party IRC networks**, not
UnifiedCore.

Archived verbatim for completeness. Flagged rather than filed silently because running them from
a ManCom-owned subscription and IP puts any resulting abuse report on ManCom.

## Excluded from this repo

- `unrealircd/conf/tls/server.key.pem` and `server.req.pem` — TLS private key and CSR
- All cleartext credentials (see `SECRETS.md`)
- Binaries, compiled modules, runtime data, logs, GeoIP databases

Full-fidelity copy of everything above lives in the Azure disk snapshot — see `SECRETS.md`.
