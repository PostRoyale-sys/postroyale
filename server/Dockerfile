# PostRoyale — сервер матчмейкинга (server/mm.py), без зависимостей.
FROM python:3.13-alpine
WORKDIR /app
COPY mm.py .
ENV HOST=0.0.0.0 PORT=8770 MM_WAIT=60 MM_CAP=20
EXPOSE 8770
CMD ["python3", "-u", "mm.py"]
