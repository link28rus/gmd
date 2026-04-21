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
  TextColumn get wifiSsid => text().nullable()();
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
  int get schemaVersion => 3;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            await m.addColumn(pendingLocations, pendingLocations.networkType);
          }
          if (from < 3) {
            await m.addColumn(pendingLocations, pendingLocations.wifiSsid);
            await m.addColumn(pendingLocations, pendingLocations.mobileOperator);
          }
        },
      );
}
