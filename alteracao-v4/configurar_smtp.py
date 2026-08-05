#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import re
import shutil
from datetime import datetime
from pathlib import Path

SIGNATURE_URL = "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEi0wOmIf_vL4iasN_lQEurWxAA2-ssiov-epwgZ2iprtRbPuxTypYvHIYlKkcEKS1QK2pLyENS4YOVFgsvp9E28ZJ5FpbLZORKS92b_ssQhkN5MFMBaQamVeV5aB2TdOgYNE083gvfXVBSDmJSx_aBkcAU5AqaWFraEyAD5vqnEOwUcwZfwdcTyjKXy/s320/45ed08d31e851604dcd0ba65ed259804.jpg"
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def quoted(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def set_values(path: Path, values: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n").splitlines()
    remaining = dict(values)
    output: list[str] = []
    for line in lines:
        if "=" not in line or line.lstrip().startswith("#"):
            output.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in remaining:
            output.append(f"{key}={quoted(remaining.pop(key))}")
        else:
            output.append(line)
    if output and output[-1].strip():
        output.append("")
    for key, value in remaining.items():
        output.append(f"{key}={quoted(value)}")
    path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Configura SMTP Gmail sem exibir a senha de aplicativo.")
    parser.add_argument("root", nargs="?", default=".", help="raiz do PerfectUtilitares")
    parser.add_argument("--email", default="dp@mercadoplanalto.com.br")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    env_path = root / "web" / ".env"
    if not env_path.is_file():
        raise SystemExit(f"ERRO: {env_path} não foi encontrado.")
    email = args.email.strip().lower()
    if not EMAIL_RE.fullmatch(email):
        raise SystemExit("ERRO: endereço SMTP inválido.")
    password = getpass.getpass("Nova senha de aplicativo do Gmail (entrada oculta): ").replace(" ", "")
    if len(password) < 12 or any(ch.isspace() for ch in password):
        raise SystemExit("ERRO: senha de aplicativo vazia ou inválida.")

    backup = env_path.with_name(f".env.backup-smtp-{datetime.now():%Y%m%d-%H%M%S}")
    shutil.copy2(env_path, backup)
    set_values(
        env_path,
        {
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "465",
            "SMTP_SECURE": "true",
            "SMTP_USER": email,
            "SMTP_PASSWORD": password,
            "SMTP_FROM_EMAIL": email,
            "SMTP_FROM_NAME": "Departamento Pessoal",
            "UNIMED_EMAIL_SIGNATURE_URL": SIGNATURE_URL,
        },
    )
    env_path.chmod(0o600)
    print(f"SMTP configurado em {env_path}.")
    print(f"Backup criado em {backup}.")
    print("A senha não foi exibida. Execute docker compose config --quiet para validar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
