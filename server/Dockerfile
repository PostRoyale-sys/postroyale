# PostRoyale — сервер матчмейкинга (server/mm.py), без зависимостей.
FROM python:3.13-alpine
WORKDIR /app
COPY mm.py .
ENV HOST=0.0.0.0 PORT=8770 MM_CAP=20 MM_BOTS0=13 MM_STEP=3
EXPOSE 8770
CMD ["python3", "-u", "mm.py"]
