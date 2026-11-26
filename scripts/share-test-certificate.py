"""Ephemeral loopback-only HTTPS proof certificate. Never installs a trusted root."""
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from pathlib import Path
import sys
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

directory = Path(sys.argv[1]).resolve()
directory.mkdir(parents=True, exist_ok=True)
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "DigitalGuide isolated local proof")])
hosts = ["player.dg-media.test", "embed.dg-site.test", "denied.dg-other.test", "outer.dg-outer.test", "localhost"]
certificate = (
    x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
    .serial_number(x509.random_serial_number()).not_valid_before(datetime.now(timezone.utc) - timedelta(minutes=1))
    .not_valid_after(datetime.now(timezone.utc) + timedelta(days=2))
    .add_extension(x509.SubjectAlternativeName([x509.DNSName(host) for host in hosts] + [x509.IPAddress(ip_address("127.0.0.1"))]), critical=False)
    .sign(key, hashes.SHA256())
)
with (directory / "key.pem").open("xb") as file:
    file.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
with (directory / "cert.pem").open("xb") as file:
    file.write(certificate.public_bytes(serialization.Encoding.PEM))
