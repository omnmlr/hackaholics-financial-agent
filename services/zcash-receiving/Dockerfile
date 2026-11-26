# Pinned NU7-aware upstream; only seed-at-rest scrypt work factor is bounded to
# 18 (256 MiB) for the Railway 1 GiB limit. Wallet/scanner/proof code is unchanged.
FROM rust:1.98.1-bookworm AS native
RUN apt-get update && apt-get install -y --no-install-recommends curl python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL --retry 3 https://codeload.github.com/Sofiia7/zec-agent-wallet/tar.gz/0a726bccbfe4a79348f77780c9fcb61789be9cb2 | tar xz --strip-components=1
RUN python3 - <<'PY'
p='src/wallet.rs'
s=open(p).read();old='let recipient = age::scrypt::Recipient::new(age::secrecy::SecretString::from(password.to_owned()));'
assert s.count(old)==1
s=s.replace(old,'let mut recipient = age::scrypt::Recipient::new(age::secrecy::SecretString::from(password.to_owned()));\n    recipient.set_work_factor(18);')
open(p,'w').write(s)
PY
RUN cargo build --release --locked --jobs 2
FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgcc-s1 && rm -rf /var/lib/apt/lists/*
COPY --from=native /build/target/release/zaw /usr/local/bin/zaw
COPY services/zcash-receiving/server.py /srv/server.py
ENV PYTHONUNBUFFERED=1
CMD ["python", "/srv/server.py"]
