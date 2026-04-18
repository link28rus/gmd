# Custom Postgres образ: postgis/postgis:16-3.4 + pg_cron.
# shared_preload_libraries=pg_cron и cron.database_name=<db> задаются
# через command override в docker-compose.prod.yml.
FROM postgis/postgis:16-3.4

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-cron \
 && rm -rf /var/lib/apt/lists/*
