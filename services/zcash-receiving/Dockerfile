FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libgcc-s1 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 3 https://github.com/Sofiia7/zec-agent-wallet/releases/download/v0.1.2/zaw-v0.1.2-linux-x86_64 -o /usr/local/bin/zaw \
 && echo '2a83cfbccf461275c28bfdd1affc62a375ae76eb2fbfbf2d757b16bbb3b8535a  /usr/local/bin/zaw' | sha256sum -c - \
 && chmod 755 /usr/local/bin/zaw
COPY services/zcash-receiving/server.py /srv/server.py
ENV PYTHONUNBUFFERED=1
CMD ["python", "/srv/server.py"]
