#!/usr/bin/env python3
"""
tor_bots.py - Populate UnifiedCore IRC with Tor-like users
Connects 40 bots with random Tor-style nicks across #lucy, #unifiedcore, #help
An oper bot assigns .onion vhosts so they look like real Tor users.
"""

import socket
import ssl
import time
import threading
import random
import string
import sys
import signal

SERVER = "127.0.0.1"
PORT = 6697

OPER_NICK = "TorMgr"
OPER_USER = "botmgr"
OPER_PASS = "<REDACTED — see SECRETS.md>"

PREFIXES = [
    "tor", "anon", "priv", "dark", "ghost", "shadow", "hidden", "void",
    "null", "crypt", "relay", "onion", "proxy", "socks", "exit", "node",
    "net", "sys", "root", "byte", "echo", "zero", "neon", "flux",
    "veil", "mask", "shade", "cipher", "route", "link"
]
SUFFIXES = [
    "user", "client", "link", "gate", "hub", "core", "box", "bit",
    "key", "dev", "op", "run", "bin", "log", "cat", "data",
    "dot", "io", "srv", "host", "peer", "node", "br", "net"
]

CHANNEL_WEIGHTS = {
    "lucy": 15,
    "unifiedcore": 15,
    "help": 10,
}

def build_channel_list():
    channels = []
    for ch, count in CHANNEL_WEIGHTS.items():
        channels.extend([ch] * count)
    random.shuffle(channels)
    return channels

def random_nick():
    prefix = random.choice(PREFIXES)
    suffix = random.choice(SUFFIXES)
    num = random.randint(10, 9999)
    return f"{prefix}{suffix}{num}"

def random_ident():
    return ''.join(random.choices(string.ascii_lowercase, k=random.randint(4, 8)))

def random_realname():
    words = ["anonymous", "private", "hidden", "user", "node", "client", "relay"]
    return f"{random.choice(words)} {random.choice(words)}"

def tor_onion_host():
    chars = string.ascii_lowercase + string.digits
    host = ''.join(random.choices(chars, k=16))
    return f"{host}.onion"


def make_ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


class TorBot(threading.Thread):
    def __init__(self, nick, channel):
        super().__init__(daemon=True)
        self.nick = nick
        self.channel = channel
        self.onion = tor_onion_host()
        self.sock = None
        self.buf = ""
        self.running = True
        self.ready = False

    def connect(self):
        raw = socket.create_connection((SERVER, PORT), timeout=20)
        self.sock = make_ssl_ctx().wrap_socket(raw, server_hostname="hub.unifiedcore.org")
        self.sock.settimeout(180)

    def send(self, msg):
        try:
            self.sock.sendall(f"{msg}\r\n".encode("utf-8"))
        except Exception:
            self.running = False

    def handle(self, line):
        parts = line.split()
        if not parts:
            return
        if parts[0] == "PING":
            self.send(f"PONG {parts[1] if len(parts) > 1 else ':keepalive'}")
            return
        if len(parts) < 2:
            return
        code = parts[1]
        if code == "001":
            time.sleep(random.uniform(0.5, 2.0))
            self.send(f"JOIN #{self.channel}")
            self.ready = True
        elif code == "433":
            self.nick = self.nick + str(random.randint(1, 9))
            self.send(f"NICK {self.nick}")
        elif code == "ERROR":
            self.running = False

    def run(self):
        try:
            self.connect()
        except Exception as e:
            print(f"[{self.nick}] connect failed: {e}", flush=True)
            return

        self.send(f"NICK {self.nick}")
        self.send(f"USER {random_ident()} 0 * :{random_realname()}")

        while self.running:
            try:
                data = self.sock.recv(4096).decode("utf-8", errors="ignore")
                if not data:
                    break
                self.buf += data
                while "\r\n" in self.buf:
                    line, self.buf = self.buf.split("\r\n", 1)
                    self.handle(line)
            except socket.timeout:
                self.send("PING :keepalive")
            except Exception as e:
                print(f"[{self.nick}] error: {e}", flush=True)
                break

        print(f"[{self.nick}] disconnected", flush=True)


class OperBot(threading.Thread):
    """Connects as IRC oper and assigns .onion vhosts to all Tor bots."""

    def __init__(self, bots):
        super().__init__(daemon=True)
        self.bots = bots
        self.sock = None
        self.buf = ""
        self.running = True
        self.opered = False
        self.vhosts_set = False

    def connect(self):
        raw = socket.create_connection((SERVER, PORT), timeout=20)
        self.sock = make_ssl_ctx().wrap_socket(raw, server_hostname="hub.unifiedcore.org")
        self.sock.settimeout(180)

    def send(self, msg):
        try:
            self.sock.sendall(f"{msg}\r\n".encode("utf-8"))
        except Exception:
            self.running = False

    def set_vhosts(self):
        print(f"[OperBot] Setting .onion vhosts on {len(self.bots)} bots...", flush=True)
        for bot in self.bots:
            if bot.is_alive():
                self.send(f"CHGHOST {bot.nick} {bot.onion}")
                time.sleep(0.1)
        self.vhosts_set = True
        print("[OperBot] All vhosts set.", flush=True)

    def handle(self, line):
        parts = line.split()
        if not parts:
            return
        if parts[0] == "PING":
            self.send(f"PONG {parts[1] if len(parts) > 1 else ':keepalive'}")
            return
        if len(parts) < 2:
            return
        code = parts[1]
        if code == "001":
            time.sleep(1.0)
            self.send(f"OPER {OPER_USER} {OPER_PASS}")
        elif code == "381":
            self.opered = True
            print("[OperBot] Oper'd up, waiting for bots to settle...", flush=True)
            time.sleep(5)
            self.set_vhosts()
        elif code == "ERROR":
            self.running = False

    def run(self):
        try:
            self.connect()
        except Exception as e:
            print(f"[OperBot] connect failed: {e}", flush=True)
            return

        self.send(f"NICK {OPER_NICK}")
        self.send(f"USER tormgr 0 * :Tor Host Manager")

        while self.running:
            try:
                data = self.sock.recv(4096).decode("utf-8", errors="ignore")
                if not data:
                    break
                self.buf += data
                while "\r\n" in self.buf:
                    line, self.buf = self.buf.split("\r\n", 1)
                    self.handle(line)
            except socket.timeout:
                self.send("PING :keepalive")
            except Exception as e:
                print(f"[OperBot] error: {e}", flush=True)
                break

        print("[OperBot] disconnected", flush=True)


def main():
    print("Starting UnifiedCore Tor user bots...", flush=True)

    channel_slots = build_channel_list()
    used_nicks = set()
    bots = []

    for i, channel in enumerate(channel_slots):
        while True:
            nick = random_nick()
            if nick not in used_nicks:
                used_nicks.add(nick)
                break

        bot = TorBot(nick, channel)
        bots.append(bot)
        bot.start()
        print(f"  [{i+1:02d}/40] {nick} -> #{channel}", flush=True)
        time.sleep(random.uniform(0.4, 0.9))

    print("\n40 Tor bots launched. Waiting for connections to settle...", flush=True)
    time.sleep(8)

    oper = OperBot(bots)
    oper.start()

    print("Running. Press Ctrl+C to stop.", flush=True)

    def shutdown(sig, frame):
        print("\nShutting down...", flush=True)
        for b in bots:
            b.running = False
            try:
                b.send("QUIT :Disconnecting")
            except Exception:
                pass
        oper.running = False
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    while True:
        alive = sum(1 for b in bots if b.is_alive())
        if alive == 0:
            print("All bots disconnected.", flush=True)
            break
        time.sleep(30)


if __name__ == "__main__":
    main()
