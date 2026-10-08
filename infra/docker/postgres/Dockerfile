# Custom Postgres образ: postgis/postgis:16-3.4 + pg_cron.
# shared_preload_libraries=pg_cron и cron.database_name=<db> задаются
# через command override в docker-compose.prod.yml.
FROM postgis/postgis:16-3.4

# 2026-10-08: PGDG убрал bullseye с apt.postgresql.org (404 на Release) —
# пакеты остались в apt-archive.postgresql.org (там тот же pg_cron 1.6.7).
# Базу образа на bookworm не переводим: другая glibc меняет сортировку
# строк, на живой базе это ломает текстовые индексы.
RUN sed -i 's#http://apt.postgresql.org/pub/repos/apt/#https://apt-archive.postgresql.org/pub/repos/apt/#' \
      /etc/apt/sources.list.d/*.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-cron \
 && rm -rf /var/lib/apt/lists/*
