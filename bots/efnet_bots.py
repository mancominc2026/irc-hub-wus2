#!/usr/bin/env python3
"""
efnet_bots.py - Populate #unifiedcore on efnet.unifiedcore.org with 40 bots
Plain TCP connection, no TLS required.
"""

import socket
import socks
import time
import threading
import random
import string
import sys
import signal

SERVER = "efnet.unifiedcore.org"
PORT = 6667
TOR_HOST = "127.0.0.1"
TOR_PORT = 9050
CHANNEL = "#unifiedcore"
BOT_COUNT = 40

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


class EFBot(threading.Thread):
    def __init__(self, nick, circuit_id):
        super().__init__(daemon=True)
        self.nick = nick
        self.circuit_id = circuit_id
        self.sock = None
        self.buf = ""
        self.running = True

    def connect(self):
        # Each unique user/pass to Tor gets an isolated circuit = different exit IP
        s = socks.socksocket()
        s.set_proxy(socks.SOCKS5, TOR_HOST, TOR_PORT,
                    username=f"bot{self.circuit_id}",
                    password=f"circ{self.circuit_id}")
        s.settimeout(60)
        s.connect((SERVER, PORT))
        s.settimeout(180)
        self.sock = s

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
            self.send(f"JOIN {CHANNEL}")
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


def main():
    print(f"Starting {BOT_COUNT} bots on {SERVER} -> {CHANNEL}...", flush=True)

    used_nicks = set()
    bots = []

    for i in range(BOT_COUNT):
        while True:
            nick = random_nick()
            if nick not in used_nicks:
                used_nicks.add(nick)
                break

        bot = EFBot(nick, i)
        bots.append(bot)
        bot.start()
        print(f"  [{i+1:02d}/{BOT_COUNT}] {nick} -> {CHANNEL}", flush=True)
        time.sleep(random.uniform(0.4, 0.9))

    print(f"\n{BOT_COUNT} bots launched. Running. Press Ctrl+C to stop.", flush=True)

    def shutdown(sig, frame):
        print("\nShutting down...", flush=True)
        for b in bots:
            b.running = False
            try:
                b.send("QUIT :Disconnecting")
            except Exception:
                pass
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
