# PostRoyale — сервер матчмейкинга (mm.py) и аккаунты/RP (rp.py), без зависимостей.
# База SQLite — в /data (том: docker run -v /opt/postroyale-mm/data:/data …), иначе RP пропадут при пересборке.
FROM python:3.13-alpine
WORKDIR /app
COPY mm.py rp.py ./
ENV HOST=0.0.0.0 PORT=8770 MM_CAP=20 MM_BOTS0=13 MM_STEP=3 DB_PATH=/data/postroyale.db RP_DAILY=800
VOLUME /data
EXPOSE 8770
CMD ["python3", "-u", "mm.py"]
