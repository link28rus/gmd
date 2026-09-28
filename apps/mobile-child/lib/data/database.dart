import 'package:drift/drift.dart';
import 'database_connection.dart';

part 'database.g.dart';

class PendingLocations extends Table {
  IntColumn get id => integer().autoIncrement()();
  RealColumn get lat => real()();
  RealColumn get lon => real()();
  RealColumn get accuracy => real().nullable()();
  RealColumn get altitude => real().nullable()();
  RealColumn get speed => real().nullable()();
  RealColumn get bearing => real().nullable()();
  IntColumn get batteryLevel => integer().nullable()();
  BoolColumn get isCharging => boolean().nullable()();
  TextColumn get provider => text().nullable()();
  TextColumn get networkType => text().nullable()();
  TextColumn get mobileOperator => text().nullable()();
  DateTimeColumn get recordedAt => dateTime()();
  IntColumn get uploadAttempts => integer().withDefault(const Constant(0))();
  DateTimeColumn get lastAttemptAt => dateTime().nullable()();
}

class AppSettings extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();
  @override
  Set<Column> get primaryKey => {key};
}

class AuditLogs extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get event => text()();
  TextColumn get details => text().nullable()();
  DateTimeColumn get at => dateTime()();
}

@DriftDatabase(tables: [PendingLocations, AppSettings, AuditLogs])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(openConnection());
  AppDatabase.forTesting(super.e);

  @override
  int get schemaVersion => 5;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            await m.addColumn(pendingLocations, pendingLocations.networkType);
          }
          if (from < 3) {
            // Историческая миграция: раньше здесь добавлялись wifiSsid +
            // mobileOperator. wifiSsid удалён в v0.53 (152-ФЗ минимизация,
            // косвенные геоданные), поэтому здесь добавляем только
            // mobileOperator. Пересоздание таблицы без wifiSsid делает шаг 3→4.
            await m.addColumn(pendingLocations, pendingLocations.mobileOperator);
          }
          if (from < 4) {
            // v0.53: убираем колонку wifiSsid из pendingLocations. SQLite до
            // 3.35 не умеет DROP COLUMN, поэтому пересоздаём таблицу через
            // TableMigration — Drift копирует все существующие pending-точки
            // (совпадающие по имени колонки переносятся автоматически),
            // orphaned wifiSsid отбрасывается. Очередь эфемерная, но точки
            // сохраняются.
            // TableMigration помечен в drift как @experimental, но это штатный
            // способ пересоздать таблицу через alterTable; новые версии
            // анализатора (Flutter 3.47+) предупреждают об этом.
            // ignore: experimental_member_use
            await m.alterTable(TableMigration(pendingLocations));
          }
          if (from < 5) {
            // v0.59.0: раньше точка после 5 неудачных отправок навсегда
            // выпадала из очереди, но физически оставалась в базе. Обнуляем
            // счётчик — такие точки уйдут на сервер при первой связи (сервер
            // принимает до 7 суток назад, более старые отсеются по возрасту).
            await customStatement('UPDATE pending_locations SET upload_attempts = 0');
          }
        },
        beforeOpen: (details) async {
          // Очередь офлайн-точек может дорасти до десятков тысяч строк;
          // выборка «самые старые» и чистка по возрасту идут по recorded_at.
          await customStatement(
            'CREATE INDEX IF NOT EXISTS idx_pending_locations_recorded_at '
            'ON pending_locations (recorded_at)',
          );
        },
      );
}
