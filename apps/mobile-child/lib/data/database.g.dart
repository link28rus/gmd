// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'database.dart';

// ignore_for_file: type=lint
class $PendingLocationsTable extends PendingLocations
    with TableInfo<$PendingLocationsTable, PendingLocation> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $PendingLocationsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _latMeta = const VerificationMeta('lat');
  @override
  late final GeneratedColumn<double> lat = GeneratedColumn<double>(
    'lat',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _lonMeta = const VerificationMeta('lon');
  @override
  late final GeneratedColumn<double> lon = GeneratedColumn<double>(
    'lon',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _accuracyMeta = const VerificationMeta(
    'accuracy',
  );
  @override
  late final GeneratedColumn<double> accuracy = GeneratedColumn<double>(
    'accuracy',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _altitudeMeta = const VerificationMeta(
    'altitude',
  );
  @override
  late final GeneratedColumn<double> altitude = GeneratedColumn<double>(
    'altitude',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _speedMeta = const VerificationMeta('speed');
  @override
  late final GeneratedColumn<double> speed = GeneratedColumn<double>(
    'speed',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _bearingMeta = const VerificationMeta(
    'bearing',
  );
  @override
  late final GeneratedColumn<double> bearing = GeneratedColumn<double>(
    'bearing',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _batteryLevelMeta = const VerificationMeta(
    'batteryLevel',
  );
  @override
  late final GeneratedColumn<int> batteryLevel = GeneratedColumn<int>(
    'battery_level',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _isChargingMeta = const VerificationMeta(
    'isCharging',
  );
  @override
  late final GeneratedColumn<bool> isCharging = GeneratedColumn<bool>(
    'is_charging',
    aliasedName,
    true,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_charging" IN (0, 1))',
    ),
  );
  static const VerificationMeta _providerMeta = const VerificationMeta(
    'provider',
  );
  @override
  late final GeneratedColumn<String> provider = GeneratedColumn<String>(
    'provider',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _networkTypeMeta = const VerificationMeta(
    'networkType',
  );
  @override
  late final GeneratedColumn<String> networkType = GeneratedColumn<String>(
    'network_type',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _wifiSsidMeta = const VerificationMeta(
    'wifiSsid',
  );
  @override
  late final GeneratedColumn<String> wifiSsid = GeneratedColumn<String>(
    'wifi_ssid',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _mobileOperatorMeta = const VerificationMeta(
    'mobileOperator',
  );
  @override
  late final GeneratedColumn<String> mobileOperator = GeneratedColumn<String>(
    'mobile_operator',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _recordedAtMeta = const VerificationMeta(
    'recordedAt',
  );
  @override
  late final GeneratedColumn<DateTime> recordedAt = GeneratedColumn<DateTime>(
    'recorded_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _uploadAttemptsMeta = const VerificationMeta(
    'uploadAttempts',
  );
  @override
  late final GeneratedColumn<int> uploadAttempts = GeneratedColumn<int>(
    'upload_attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _lastAttemptAtMeta = const VerificationMeta(
    'lastAttemptAt',
  );
  @override
  late final GeneratedColumn<DateTime> lastAttemptAt =
      GeneratedColumn<DateTime>(
        'last_attempt_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    lat,
    lon,
    accuracy,
    altitude,
    speed,
    bearing,
    batteryLevel,
    isCharging,
    provider,
    networkType,
    wifiSsid,
    mobileOperator,
    recordedAt,
    uploadAttempts,
    lastAttemptAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'pending_locations';
  @override
  VerificationContext validateIntegrity(
    Insertable<PendingLocation> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('lat')) {
      context.handle(
        _latMeta,
        lat.isAcceptableOrUnknown(data['lat']!, _latMeta),
      );
    } else if (isInserting) {
      context.missing(_latMeta);
    }
    if (data.containsKey('lon')) {
      context.handle(
        _lonMeta,
        lon.isAcceptableOrUnknown(data['lon']!, _lonMeta),
      );
    } else if (isInserting) {
      context.missing(_lonMeta);
    }
    if (data.containsKey('accuracy')) {
      context.handle(
        _accuracyMeta,
        accuracy.isAcceptableOrUnknown(data['accuracy']!, _accuracyMeta),
      );
    }
    if (data.containsKey('altitude')) {
      context.handle(
        _altitudeMeta,
        altitude.isAcceptableOrUnknown(data['altitude']!, _altitudeMeta),
      );
    }
    if (data.containsKey('speed')) {
      context.handle(
        _speedMeta,
        speed.isAcceptableOrUnknown(data['speed']!, _speedMeta),
      );
    }
    if (data.containsKey('bearing')) {
      context.handle(
        _bearingMeta,
        bearing.isAcceptableOrUnknown(data['bearing']!, _bearingMeta),
      );
    }
    if (data.containsKey('battery_level')) {
      context.handle(
        _batteryLevelMeta,
        batteryLevel.isAcceptableOrUnknown(
          data['battery_level']!,
          _batteryLevelMeta,
        ),
      );
    }
    if (data.containsKey('is_charging')) {
      context.handle(
        _isChargingMeta,
        isCharging.isAcceptableOrUnknown(data['is_charging']!, _isChargingMeta),
      );
    }
    if (data.containsKey('provider')) {
      context.handle(
        _providerMeta,
        provider.isAcceptableOrUnknown(data['provider']!, _providerMeta),
      );
    }
    if (data.containsKey('network_type')) {
      context.handle(
        _networkTypeMeta,
        networkType.isAcceptableOrUnknown(
          data['network_type']!,
          _networkTypeMeta,
        ),
      );
    }
    if (data.containsKey('wifi_ssid')) {
      context.handle(
        _wifiSsidMeta,
        wifiSsid.isAcceptableOrUnknown(data['wifi_ssid']!, _wifiSsidMeta),
      );
    }
    if (data.containsKey('mobile_operator')) {
      context.handle(
        _mobileOperatorMeta,
        mobileOperator.isAcceptableOrUnknown(
          data['mobile_operator']!,
          _mobileOperatorMeta,
        ),
      );
    }
    if (data.containsKey('recorded_at')) {
      context.handle(
        _recordedAtMeta,
        recordedAt.isAcceptableOrUnknown(data['recorded_at']!, _recordedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_recordedAtMeta);
    }
    if (data.containsKey('upload_attempts')) {
      context.handle(
        _uploadAttemptsMeta,
        uploadAttempts.isAcceptableOrUnknown(
          data['upload_attempts']!,
          _uploadAttemptsMeta,
        ),
      );
    }
    if (data.containsKey('last_attempt_at')) {
      context.handle(
        _lastAttemptAtMeta,
        lastAttemptAt.isAcceptableOrUnknown(
          data['last_attempt_at']!,
          _lastAttemptAtMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  PendingLocation map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return PendingLocation(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      lat: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}lat'],
      )!,
      lon: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}lon'],
      )!,
      accuracy: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}accuracy'],
      ),
      altitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}altitude'],
      ),
      speed: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}speed'],
      ),
      bearing: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}bearing'],
      ),
      batteryLevel: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}battery_level'],
      ),
      isCharging: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_charging'],
      ),
      provider: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}provider'],
      ),
      networkType: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}network_type'],
      ),
      wifiSsid: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}wifi_ssid'],
      ),
      mobileOperator: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}mobile_operator'],
      ),
      recordedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}recorded_at'],
      )!,
      uploadAttempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}upload_attempts'],
      )!,
      lastAttemptAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}last_attempt_at'],
      ),
    );
  }

  @override
  $PendingLocationsTable createAlias(String alias) {
    return $PendingLocationsTable(attachedDatabase, alias);
  }
}

class PendingLocation extends DataClass implements Insertable<PendingLocation> {
  final int id;
  final double lat;
  final double lon;
  final double? accuracy;
  final double? altitude;
  final double? speed;
  final double? bearing;
  final int? batteryLevel;
  final bool? isCharging;
  final String? provider;
  final String? networkType;
  final String? wifiSsid;
  final String? mobileOperator;
  final DateTime recordedAt;
  final int uploadAttempts;
  final DateTime? lastAttemptAt;
  const PendingLocation({
    required this.id,
    required this.lat,
    required this.lon,
    this.accuracy,
    this.altitude,
    this.speed,
    this.bearing,
    this.batteryLevel,
    this.isCharging,
    this.provider,
    this.networkType,
    this.wifiSsid,
    this.mobileOperator,
    required this.recordedAt,
    required this.uploadAttempts,
    this.lastAttemptAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['lat'] = Variable<double>(lat);
    map['lon'] = Variable<double>(lon);
    if (!nullToAbsent || accuracy != null) {
      map['accuracy'] = Variable<double>(accuracy);
    }
    if (!nullToAbsent || altitude != null) {
      map['altitude'] = Variable<double>(altitude);
    }
    if (!nullToAbsent || speed != null) {
      map['speed'] = Variable<double>(speed);
    }
    if (!nullToAbsent || bearing != null) {
      map['bearing'] = Variable<double>(bearing);
    }
    if (!nullToAbsent || batteryLevel != null) {
      map['battery_level'] = Variable<int>(batteryLevel);
    }
    if (!nullToAbsent || isCharging != null) {
      map['is_charging'] = Variable<bool>(isCharging);
    }
    if (!nullToAbsent || provider != null) {
      map['provider'] = Variable<String>(provider);
    }
    if (!nullToAbsent || networkType != null) {
      map['network_type'] = Variable<String>(networkType);
    }
    if (!nullToAbsent || wifiSsid != null) {
      map['wifi_ssid'] = Variable<String>(wifiSsid);
    }
    if (!nullToAbsent || mobileOperator != null) {
      map['mobile_operator'] = Variable<String>(mobileOperator);
    }
    map['recorded_at'] = Variable<DateTime>(recordedAt);
    map['upload_attempts'] = Variable<int>(uploadAttempts);
    if (!nullToAbsent || lastAttemptAt != null) {
      map['last_attempt_at'] = Variable<DateTime>(lastAttemptAt);
    }
    return map;
  }

  PendingLocationsCompanion toCompanion(bool nullToAbsent) {
    return PendingLocationsCompanion(
      id: Value(id),
      lat: Value(lat),
      lon: Value(lon),
      accuracy: accuracy == null && nullToAbsent
          ? const Value.absent()
          : Value(accuracy),
      altitude: altitude == null && nullToAbsent
          ? const Value.absent()
          : Value(altitude),
      speed: speed == null && nullToAbsent
          ? const Value.absent()
          : Value(speed),
      bearing: bearing == null && nullToAbsent
          ? const Value.absent()
          : Value(bearing),
      batteryLevel: batteryLevel == null && nullToAbsent
          ? const Value.absent()
          : Value(batteryLevel),
      isCharging: isCharging == null && nullToAbsent
          ? const Value.absent()
          : Value(isCharging),
      provider: provider == null && nullToAbsent
          ? const Value.absent()
          : Value(provider),
      networkType: networkType == null && nullToAbsent
          ? const Value.absent()
          : Value(networkType),
      wifiSsid: wifiSsid == null && nullToAbsent
          ? const Value.absent()
          : Value(wifiSsid),
      mobileOperator: mobileOperator == null && nullToAbsent
          ? const Value.absent()
          : Value(mobileOperator),
      recordedAt: Value(recordedAt),
      uploadAttempts: Value(uploadAttempts),
      lastAttemptAt: lastAttemptAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastAttemptAt),
    );
  }

  factory PendingLocation.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return PendingLocation(
      id: serializer.fromJson<int>(json['id']),
      lat: serializer.fromJson<double>(json['lat']),
      lon: serializer.fromJson<double>(json['lon']),
      accuracy: serializer.fromJson<double?>(json['accuracy']),
      altitude: serializer.fromJson<double?>(json['altitude']),
      speed: serializer.fromJson<double?>(json['speed']),
      bearing: serializer.fromJson<double?>(json['bearing']),
      batteryLevel: serializer.fromJson<int?>(json['batteryLevel']),
      isCharging: serializer.fromJson<bool?>(json['isCharging']),
      provider: serializer.fromJson<String?>(json['provider']),
      networkType: serializer.fromJson<String?>(json['networkType']),
      wifiSsid: serializer.fromJson<String?>(json['wifiSsid']),
      mobileOperator: serializer.fromJson<String?>(json['mobileOperator']),
      recordedAt: serializer.fromJson<DateTime>(json['recordedAt']),
      uploadAttempts: serializer.fromJson<int>(json['uploadAttempts']),
      lastAttemptAt: serializer.fromJson<DateTime?>(json['lastAttemptAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'lat': serializer.toJson<double>(lat),
      'lon': serializer.toJson<double>(lon),
      'accuracy': serializer.toJson<double?>(accuracy),
      'altitude': serializer.toJson<double?>(altitude),
      'speed': serializer.toJson<double?>(speed),
      'bearing': serializer.toJson<double?>(bearing),
      'batteryLevel': serializer.toJson<int?>(batteryLevel),
      'isCharging': serializer.toJson<bool?>(isCharging),
      'provider': serializer.toJson<String?>(provider),
      'networkType': serializer.toJson<String?>(networkType),
      'wifiSsid': serializer.toJson<String?>(wifiSsid),
      'mobileOperator': serializer.toJson<String?>(mobileOperator),
      'recordedAt': serializer.toJson<DateTime>(recordedAt),
      'uploadAttempts': serializer.toJson<int>(uploadAttempts),
      'lastAttemptAt': serializer.toJson<DateTime?>(lastAttemptAt),
    };
  }

  PendingLocation copyWith({
    int? id,
    double? lat,
    double? lon,
    Value<double?> accuracy = const Value.absent(),
    Value<double?> altitude = const Value.absent(),
    Value<double?> speed = const Value.absent(),
    Value<double?> bearing = const Value.absent(),
    Value<int?> batteryLevel = const Value.absent(),
    Value<bool?> isCharging = const Value.absent(),
    Value<String?> provider = const Value.absent(),
    Value<String?> networkType = const Value.absent(),
    Value<String?> wifiSsid = const Value.absent(),
    Value<String?> mobileOperator = const Value.absent(),
    DateTime? recordedAt,
    int? uploadAttempts,
    Value<DateTime?> lastAttemptAt = const Value.absent(),
  }) => PendingLocation(
    id: id ?? this.id,
    lat: lat ?? this.lat,
    lon: lon ?? this.lon,
    accuracy: accuracy.present ? accuracy.value : this.accuracy,
    altitude: altitude.present ? altitude.value : this.altitude,
    speed: speed.present ? speed.value : this.speed,
    bearing: bearing.present ? bearing.value : this.bearing,
    batteryLevel: batteryLevel.present ? batteryLevel.value : this.batteryLevel,
    isCharging: isCharging.present ? isCharging.value : this.isCharging,
    provider: provider.present ? provider.value : this.provider,
    networkType: networkType.present ? networkType.value : this.networkType,
    wifiSsid: wifiSsid.present ? wifiSsid.value : this.wifiSsid,
    mobileOperator: mobileOperator.present
        ? mobileOperator.value
        : this.mobileOperator,
    recordedAt: recordedAt ?? this.recordedAt,
    uploadAttempts: uploadAttempts ?? this.uploadAttempts,
    lastAttemptAt: lastAttemptAt.present
        ? lastAttemptAt.value
        : this.lastAttemptAt,
  );
  PendingLocation copyWithCompanion(PendingLocationsCompanion data) {
    return PendingLocation(
      id: data.id.present ? data.id.value : this.id,
      lat: data.lat.present ? data.lat.value : this.lat,
      lon: data.lon.present ? data.lon.value : this.lon,
      accuracy: data.accuracy.present ? data.accuracy.value : this.accuracy,
      altitude: data.altitude.present ? data.altitude.value : this.altitude,
      speed: data.speed.present ? data.speed.value : this.speed,
      bearing: data.bearing.present ? data.bearing.value : this.bearing,
      batteryLevel: data.batteryLevel.present
          ? data.batteryLevel.value
          : this.batteryLevel,
      isCharging: data.isCharging.present
          ? data.isCharging.value
          : this.isCharging,
      provider: data.provider.present ? data.provider.value : this.provider,
      networkType: data.networkType.present
          ? data.networkType.value
          : this.networkType,
      wifiSsid: data.wifiSsid.present ? data.wifiSsid.value : this.wifiSsid,
      mobileOperator: data.mobileOperator.present
          ? data.mobileOperator.value
          : this.mobileOperator,
      recordedAt: data.recordedAt.present
          ? data.recordedAt.value
          : this.recordedAt,
      uploadAttempts: data.uploadAttempts.present
          ? data.uploadAttempts.value
          : this.uploadAttempts,
      lastAttemptAt: data.lastAttemptAt.present
          ? data.lastAttemptAt.value
          : this.lastAttemptAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('PendingLocation(')
          ..write('id: $id, ')
          ..write('lat: $lat, ')
          ..write('lon: $lon, ')
          ..write('accuracy: $accuracy, ')
          ..write('altitude: $altitude, ')
          ..write('speed: $speed, ')
          ..write('bearing: $bearing, ')
          ..write('batteryLevel: $batteryLevel, ')
          ..write('isCharging: $isCharging, ')
          ..write('provider: $provider, ')
          ..write('networkType: $networkType, ')
          ..write('wifiSsid: $wifiSsid, ')
          ..write('mobileOperator: $mobileOperator, ')
          ..write('recordedAt: $recordedAt, ')
          ..write('uploadAttempts: $uploadAttempts, ')
          ..write('lastAttemptAt: $lastAttemptAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    lat,
    lon,
    accuracy,
    altitude,
    speed,
    bearing,
    batteryLevel,
    isCharging,
    provider,
    networkType,
    wifiSsid,
    mobileOperator,
    recordedAt,
    uploadAttempts,
    lastAttemptAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PendingLocation &&
          other.id == this.id &&
          other.lat == this.lat &&
          other.lon == this.lon &&
          other.accuracy == this.accuracy &&
          other.altitude == this.altitude &&
          other.speed == this.speed &&
          other.bearing == this.bearing &&
          other.batteryLevel == this.batteryLevel &&
          other.isCharging == this.isCharging &&
          other.provider == this.provider &&
          other.networkType == this.networkType &&
          other.wifiSsid == this.wifiSsid &&
          other.mobileOperator == this.mobileOperator &&
          other.recordedAt == this.recordedAt &&
          other.uploadAttempts == this.uploadAttempts &&
          other.lastAttemptAt == this.lastAttemptAt);
}

class PendingLocationsCompanion extends UpdateCompanion<PendingLocation> {
  final Value<int> id;
  final Value<double> lat;
  final Value<double> lon;
  final Value<double?> accuracy;
  final Value<double?> altitude;
  final Value<double?> speed;
  final Value<double?> bearing;
  final Value<int?> batteryLevel;
  final Value<bool?> isCharging;
  final Value<String?> provider;
  final Value<String?> networkType;
  final Value<String?> wifiSsid;
  final Value<String?> mobileOperator;
  final Value<DateTime> recordedAt;
  final Value<int> uploadAttempts;
  final Value<DateTime?> lastAttemptAt;
  const PendingLocationsCompanion({
    this.id = const Value.absent(),
    this.lat = const Value.absent(),
    this.lon = const Value.absent(),
    this.accuracy = const Value.absent(),
    this.altitude = const Value.absent(),
    this.speed = const Value.absent(),
    this.bearing = const Value.absent(),
    this.batteryLevel = const Value.absent(),
    this.isCharging = const Value.absent(),
    this.provider = const Value.absent(),
    this.networkType = const Value.absent(),
    this.wifiSsid = const Value.absent(),
    this.mobileOperator = const Value.absent(),
    this.recordedAt = const Value.absent(),
    this.uploadAttempts = const Value.absent(),
    this.lastAttemptAt = const Value.absent(),
  });
  PendingLocationsCompanion.insert({
    this.id = const Value.absent(),
    required double lat,
    required double lon,
    this.accuracy = const Value.absent(),
    this.altitude = const Value.absent(),
    this.speed = const Value.absent(),
    this.bearing = const Value.absent(),
    this.batteryLevel = const Value.absent(),
    this.isCharging = const Value.absent(),
    this.provider = const Value.absent(),
    this.networkType = const Value.absent(),
    this.wifiSsid = const Value.absent(),
    this.mobileOperator = const Value.absent(),
    required DateTime recordedAt,
    this.uploadAttempts = const Value.absent(),
    this.lastAttemptAt = const Value.absent(),
  }) : lat = Value(lat),
       lon = Value(lon),
       recordedAt = Value(recordedAt);
  static Insertable<PendingLocation> custom({
    Expression<int>? id,
    Expression<double>? lat,
    Expression<double>? lon,
    Expression<double>? accuracy,
    Expression<double>? altitude,
    Expression<double>? speed,
    Expression<double>? bearing,
    Expression<int>? batteryLevel,
    Expression<bool>? isCharging,
    Expression<String>? provider,
    Expression<String>? networkType,
    Expression<String>? wifiSsid,
    Expression<String>? mobileOperator,
    Expression<DateTime>? recordedAt,
    Expression<int>? uploadAttempts,
    Expression<DateTime>? lastAttemptAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (lat != null) 'lat': lat,
      if (lon != null) 'lon': lon,
      if (accuracy != null) 'accuracy': accuracy,
      if (altitude != null) 'altitude': altitude,
      if (speed != null) 'speed': speed,
      if (bearing != null) 'bearing': bearing,
      if (batteryLevel != null) 'battery_level': batteryLevel,
      if (isCharging != null) 'is_charging': isCharging,
      if (provider != null) 'provider': provider,
      if (networkType != null) 'network_type': networkType,
      if (wifiSsid != null) 'wifi_ssid': wifiSsid,
      if (mobileOperator != null) 'mobile_operator': mobileOperator,
      if (recordedAt != null) 'recorded_at': recordedAt,
      if (uploadAttempts != null) 'upload_attempts': uploadAttempts,
      if (lastAttemptAt != null) 'last_attempt_at': lastAttemptAt,
    });
  }

  PendingLocationsCompanion copyWith({
    Value<int>? id,
    Value<double>? lat,
    Value<double>? lon,
    Value<double?>? accuracy,
    Value<double?>? altitude,
    Value<double?>? speed,
    Value<double?>? bearing,
    Value<int?>? batteryLevel,
    Value<bool?>? isCharging,
    Value<String?>? provider,
    Value<String?>? networkType,
    Value<String?>? wifiSsid,
    Value<String?>? mobileOperator,
    Value<DateTime>? recordedAt,
    Value<int>? uploadAttempts,
    Value<DateTime?>? lastAttemptAt,
  }) {
    return PendingLocationsCompanion(
      id: id ?? this.id,
      lat: lat ?? this.lat,
      lon: lon ?? this.lon,
      accuracy: accuracy ?? this.accuracy,
      altitude: altitude ?? this.altitude,
      speed: speed ?? this.speed,
      bearing: bearing ?? this.bearing,
      batteryLevel: batteryLevel ?? this.batteryLevel,
      isCharging: isCharging ?? this.isCharging,
      provider: provider ?? this.provider,
      networkType: networkType ?? this.networkType,
      wifiSsid: wifiSsid ?? this.wifiSsid,
      mobileOperator: mobileOperator ?? this.mobileOperator,
      recordedAt: recordedAt ?? this.recordedAt,
      uploadAttempts: uploadAttempts ?? this.uploadAttempts,
      lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (lat.present) {
      map['lat'] = Variable<double>(lat.value);
    }
    if (lon.present) {
      map['lon'] = Variable<double>(lon.value);
    }
    if (accuracy.present) {
      map['accuracy'] = Variable<double>(accuracy.value);
    }
    if (altitude.present) {
      map['altitude'] = Variable<double>(altitude.value);
    }
    if (speed.present) {
      map['speed'] = Variable<double>(speed.value);
    }
    if (bearing.present) {
      map['bearing'] = Variable<double>(bearing.value);
    }
    if (batteryLevel.present) {
      map['battery_level'] = Variable<int>(batteryLevel.value);
    }
    if (isCharging.present) {
      map['is_charging'] = Variable<bool>(isCharging.value);
    }
    if (provider.present) {
      map['provider'] = Variable<String>(provider.value);
    }
    if (networkType.present) {
      map['network_type'] = Variable<String>(networkType.value);
    }
    if (wifiSsid.present) {
      map['wifi_ssid'] = Variable<String>(wifiSsid.value);
    }
    if (mobileOperator.present) {
      map['mobile_operator'] = Variable<String>(mobileOperator.value);
    }
    if (recordedAt.present) {
      map['recorded_at'] = Variable<DateTime>(recordedAt.value);
    }
    if (uploadAttempts.present) {
      map['upload_attempts'] = Variable<int>(uploadAttempts.value);
    }
    if (lastAttemptAt.present) {
      map['last_attempt_at'] = Variable<DateTime>(lastAttemptAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('PendingLocationsCompanion(')
          ..write('id: $id, ')
          ..write('lat: $lat, ')
          ..write('lon: $lon, ')
          ..write('accuracy: $accuracy, ')
          ..write('altitude: $altitude, ')
          ..write('speed: $speed, ')
          ..write('bearing: $bearing, ')
          ..write('batteryLevel: $batteryLevel, ')
          ..write('isCharging: $isCharging, ')
          ..write('provider: $provider, ')
          ..write('networkType: $networkType, ')
          ..write('wifiSsid: $wifiSsid, ')
          ..write('mobileOperator: $mobileOperator, ')
          ..write('recordedAt: $recordedAt, ')
          ..write('uploadAttempts: $uploadAttempts, ')
          ..write('lastAttemptAt: $lastAttemptAt')
          ..write(')'))
        .toString();
  }
}

class $AppSettingsTable extends AppSettings
    with TableInfo<$AppSettingsTable, AppSetting> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $AppSettingsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'app_settings';
  @override
  VerificationContext validateIntegrity(
    Insertable<AppSetting> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  AppSetting map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return AppSetting(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
    );
  }

  @override
  $AppSettingsTable createAlias(String alias) {
    return $AppSettingsTable(attachedDatabase, alias);
  }
}

class AppSetting extends DataClass implements Insertable<AppSetting> {
  final String key;
  final String value;
  const AppSetting({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  AppSettingsCompanion toCompanion(bool nullToAbsent) {
    return AppSettingsCompanion(key: Value(key), value: Value(value));
  }

  factory AppSetting.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return AppSetting(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
    };
  }

  AppSetting copyWith({String? key, String? value}) =>
      AppSetting(key: key ?? this.key, value: value ?? this.value);
  AppSetting copyWithCompanion(AppSettingsCompanion data) {
    return AppSetting(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('AppSetting(')
          ..write('key: $key, ')
          ..write('value: $value')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AppSetting &&
          other.key == this.key &&
          other.value == this.value);
}

class AppSettingsCompanion extends UpdateCompanion<AppSetting> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const AppSettingsCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  AppSettingsCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value);
  static Insertable<AppSetting> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (rowid != null) 'rowid': rowid,
    });
  }

  AppSettingsCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<int>? rowid,
  }) {
    return AppSettingsCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('AppSettingsCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $AuditLogsTable extends AuditLogs
    with TableInfo<$AuditLogsTable, AuditLog> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $AuditLogsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _eventMeta = const VerificationMeta('event');
  @override
  late final GeneratedColumn<String> event = GeneratedColumn<String>(
    'event',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _detailsMeta = const VerificationMeta(
    'details',
  );
  @override
  late final GeneratedColumn<String> details = GeneratedColumn<String>(
    'details',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _atMeta = const VerificationMeta('at');
  @override
  late final GeneratedColumn<DateTime> at = GeneratedColumn<DateTime>(
    'at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [id, event, details, at];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'audit_logs';
  @override
  VerificationContext validateIntegrity(
    Insertable<AuditLog> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('event')) {
      context.handle(
        _eventMeta,
        event.isAcceptableOrUnknown(data['event']!, _eventMeta),
      );
    } else if (isInserting) {
      context.missing(_eventMeta);
    }
    if (data.containsKey('details')) {
      context.handle(
        _detailsMeta,
        details.isAcceptableOrUnknown(data['details']!, _detailsMeta),
      );
    }
    if (data.containsKey('at')) {
      context.handle(_atMeta, at.isAcceptableOrUnknown(data['at']!, _atMeta));
    } else if (isInserting) {
      context.missing(_atMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  AuditLog map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return AuditLog(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      event: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}event'],
      )!,
      details: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}details'],
      ),
      at: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}at'],
      )!,
    );
  }

  @override
  $AuditLogsTable createAlias(String alias) {
    return $AuditLogsTable(attachedDatabase, alias);
  }
}

class AuditLog extends DataClass implements Insertable<AuditLog> {
  final int id;
  final String event;
  final String? details;
  final DateTime at;
  const AuditLog({
    required this.id,
    required this.event,
    this.details,
    required this.at,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['event'] = Variable<String>(event);
    if (!nullToAbsent || details != null) {
      map['details'] = Variable<String>(details);
    }
    map['at'] = Variable<DateTime>(at);
    return map;
  }

  AuditLogsCompanion toCompanion(bool nullToAbsent) {
    return AuditLogsCompanion(
      id: Value(id),
      event: Value(event),
      details: details == null && nullToAbsent
          ? const Value.absent()
          : Value(details),
      at: Value(at),
    );
  }

  factory AuditLog.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return AuditLog(
      id: serializer.fromJson<int>(json['id']),
      event: serializer.fromJson<String>(json['event']),
      details: serializer.fromJson<String?>(json['details']),
      at: serializer.fromJson<DateTime>(json['at']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'event': serializer.toJson<String>(event),
      'details': serializer.toJson<String?>(details),
      'at': serializer.toJson<DateTime>(at),
    };
  }

  AuditLog copyWith({
    int? id,
    String? event,
    Value<String?> details = const Value.absent(),
    DateTime? at,
  }) => AuditLog(
    id: id ?? this.id,
    event: event ?? this.event,
    details: details.present ? details.value : this.details,
    at: at ?? this.at,
  );
  AuditLog copyWithCompanion(AuditLogsCompanion data) {
    return AuditLog(
      id: data.id.present ? data.id.value : this.id,
      event: data.event.present ? data.event.value : this.event,
      details: data.details.present ? data.details.value : this.details,
      at: data.at.present ? data.at.value : this.at,
    );
  }

  @override
  String toString() {
    return (StringBuffer('AuditLog(')
          ..write('id: $id, ')
          ..write('event: $event, ')
          ..write('details: $details, ')
          ..write('at: $at')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, event, details, at);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is AuditLog &&
          other.id == this.id &&
          other.event == this.event &&
          other.details == this.details &&
          other.at == this.at);
}

class AuditLogsCompanion extends UpdateCompanion<AuditLog> {
  final Value<int> id;
  final Value<String> event;
  final Value<String?> details;
  final Value<DateTime> at;
  const AuditLogsCompanion({
    this.id = const Value.absent(),
    this.event = const Value.absent(),
    this.details = const Value.absent(),
    this.at = const Value.absent(),
  });
  AuditLogsCompanion.insert({
    this.id = const Value.absent(),
    required String event,
    this.details = const Value.absent(),
    required DateTime at,
  }) : event = Value(event),
       at = Value(at);
  static Insertable<AuditLog> custom({
    Expression<int>? id,
    Expression<String>? event,
    Expression<String>? details,
    Expression<DateTime>? at,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (event != null) 'event': event,
      if (details != null) 'details': details,
      if (at != null) 'at': at,
    });
  }

  AuditLogsCompanion copyWith({
    Value<int>? id,
    Value<String>? event,
    Value<String?>? details,
    Value<DateTime>? at,
  }) {
    return AuditLogsCompanion(
      id: id ?? this.id,
      event: event ?? this.event,
      details: details ?? this.details,
      at: at ?? this.at,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (event.present) {
      map['event'] = Variable<String>(event.value);
    }
    if (details.present) {
      map['details'] = Variable<String>(details.value);
    }
    if (at.present) {
      map['at'] = Variable<DateTime>(at.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('AuditLogsCompanion(')
          ..write('id: $id, ')
          ..write('event: $event, ')
          ..write('details: $details, ')
          ..write('at: $at')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $PendingLocationsTable pendingLocations = $PendingLocationsTable(
    this,
  );
  late final $AppSettingsTable appSettings = $AppSettingsTable(this);
  late final $AuditLogsTable auditLogs = $AuditLogsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    pendingLocations,
    appSettings,
    auditLogs,
  ];
}

typedef $$PendingLocationsTableCreateCompanionBuilder =
    PendingLocationsCompanion Function({
      Value<int> id,
      required double lat,
      required double lon,
      Value<double?> accuracy,
      Value<double?> altitude,
      Value<double?> speed,
      Value<double?> bearing,
      Value<int?> batteryLevel,
      Value<bool?> isCharging,
      Value<String?> provider,
      Value<String?> networkType,
      Value<String?> wifiSsid,
      Value<String?> mobileOperator,
      required DateTime recordedAt,
      Value<int> uploadAttempts,
      Value<DateTime?> lastAttemptAt,
    });
typedef $$PendingLocationsTableUpdateCompanionBuilder =
    PendingLocationsCompanion Function({
      Value<int> id,
      Value<double> lat,
      Value<double> lon,
      Value<double?> accuracy,
      Value<double?> altitude,
      Value<double?> speed,
      Value<double?> bearing,
      Value<int?> batteryLevel,
      Value<bool?> isCharging,
      Value<String?> provider,
      Value<String?> networkType,
      Value<String?> wifiSsid,
      Value<String?> mobileOperator,
      Value<DateTime> recordedAt,
      Value<int> uploadAttempts,
      Value<DateTime?> lastAttemptAt,
    });

class $$PendingLocationsTableFilterComposer
    extends Composer<_$AppDatabase, $PendingLocationsTable> {
  $$PendingLocationsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get lat => $composableBuilder(
    column: $table.lat,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get lon => $composableBuilder(
    column: $table.lon,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get accuracy => $composableBuilder(
    column: $table.accuracy,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get altitude => $composableBuilder(
    column: $table.altitude,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get speed => $composableBuilder(
    column: $table.speed,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get bearing => $composableBuilder(
    column: $table.bearing,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get batteryLevel => $composableBuilder(
    column: $table.batteryLevel,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isCharging => $composableBuilder(
    column: $table.isCharging,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get provider => $composableBuilder(
    column: $table.provider,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get networkType => $composableBuilder(
    column: $table.networkType,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get wifiSsid => $composableBuilder(
    column: $table.wifiSsid,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get mobileOperator => $composableBuilder(
    column: $table.mobileOperator,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get recordedAt => $composableBuilder(
    column: $table.recordedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get uploadAttempts => $composableBuilder(
    column: $table.uploadAttempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get lastAttemptAt => $composableBuilder(
    column: $table.lastAttemptAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$PendingLocationsTableOrderingComposer
    extends Composer<_$AppDatabase, $PendingLocationsTable> {
  $$PendingLocationsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get lat => $composableBuilder(
    column: $table.lat,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get lon => $composableBuilder(
    column: $table.lon,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get accuracy => $composableBuilder(
    column: $table.accuracy,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get altitude => $composableBuilder(
    column: $table.altitude,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get speed => $composableBuilder(
    column: $table.speed,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get bearing => $composableBuilder(
    column: $table.bearing,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get batteryLevel => $composableBuilder(
    column: $table.batteryLevel,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isCharging => $composableBuilder(
    column: $table.isCharging,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get provider => $composableBuilder(
    column: $table.provider,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get networkType => $composableBuilder(
    column: $table.networkType,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get wifiSsid => $composableBuilder(
    column: $table.wifiSsid,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get mobileOperator => $composableBuilder(
    column: $table.mobileOperator,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get recordedAt => $composableBuilder(
    column: $table.recordedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get uploadAttempts => $composableBuilder(
    column: $table.uploadAttempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get lastAttemptAt => $composableBuilder(
    column: $table.lastAttemptAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$PendingLocationsTableAnnotationComposer
    extends Composer<_$AppDatabase, $PendingLocationsTable> {
  $$PendingLocationsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<double> get lat =>
      $composableBuilder(column: $table.lat, builder: (column) => column);

  GeneratedColumn<double> get lon =>
      $composableBuilder(column: $table.lon, builder: (column) => column);

  GeneratedColumn<double> get accuracy =>
      $composableBuilder(column: $table.accuracy, builder: (column) => column);

  GeneratedColumn<double> get altitude =>
      $composableBuilder(column: $table.altitude, builder: (column) => column);

  GeneratedColumn<double> get speed =>
      $composableBuilder(column: $table.speed, builder: (column) => column);

  GeneratedColumn<double> get bearing =>
      $composableBuilder(column: $table.bearing, builder: (column) => column);

  GeneratedColumn<int> get batteryLevel => $composableBuilder(
    column: $table.batteryLevel,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get isCharging => $composableBuilder(
    column: $table.isCharging,
    builder: (column) => column,
  );

  GeneratedColumn<String> get provider =>
      $composableBuilder(column: $table.provider, builder: (column) => column);

  GeneratedColumn<String> get networkType => $composableBuilder(
    column: $table.networkType,
    builder: (column) => column,
  );

  GeneratedColumn<String> get wifiSsid =>
      $composableBuilder(column: $table.wifiSsid, builder: (column) => column);

  GeneratedColumn<String> get mobileOperator => $composableBuilder(
    column: $table.mobileOperator,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get recordedAt => $composableBuilder(
    column: $table.recordedAt,
    builder: (column) => column,
  );

  GeneratedColumn<int> get uploadAttempts => $composableBuilder(
    column: $table.uploadAttempts,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get lastAttemptAt => $composableBuilder(
    column: $table.lastAttemptAt,
    builder: (column) => column,
  );
}

class $$PendingLocationsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $PendingLocationsTable,
          PendingLocation,
          $$PendingLocationsTableFilterComposer,
          $$PendingLocationsTableOrderingComposer,
          $$PendingLocationsTableAnnotationComposer,
          $$PendingLocationsTableCreateCompanionBuilder,
          $$PendingLocationsTableUpdateCompanionBuilder,
          (
            PendingLocation,
            BaseReferences<
              _$AppDatabase,
              $PendingLocationsTable,
              PendingLocation
            >,
          ),
          PendingLocation,
          PrefetchHooks Function()
        > {
  $$PendingLocationsTableTableManager(
    _$AppDatabase db,
    $PendingLocationsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$PendingLocationsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$PendingLocationsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$PendingLocationsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<double> lat = const Value.absent(),
                Value<double> lon = const Value.absent(),
                Value<double?> accuracy = const Value.absent(),
                Value<double?> altitude = const Value.absent(),
                Value<double?> speed = const Value.absent(),
                Value<double?> bearing = const Value.absent(),
                Value<int?> batteryLevel = const Value.absent(),
                Value<bool?> isCharging = const Value.absent(),
                Value<String?> provider = const Value.absent(),
                Value<String?> networkType = const Value.absent(),
                Value<String?> wifiSsid = const Value.absent(),
                Value<String?> mobileOperator = const Value.absent(),
                Value<DateTime> recordedAt = const Value.absent(),
                Value<int> uploadAttempts = const Value.absent(),
                Value<DateTime?> lastAttemptAt = const Value.absent(),
              }) => PendingLocationsCompanion(
                id: id,
                lat: lat,
                lon: lon,
                accuracy: accuracy,
                altitude: altitude,
                speed: speed,
                bearing: bearing,
                batteryLevel: batteryLevel,
                isCharging: isCharging,
                provider: provider,
                networkType: networkType,
                wifiSsid: wifiSsid,
                mobileOperator: mobileOperator,
                recordedAt: recordedAt,
                uploadAttempts: uploadAttempts,
                lastAttemptAt: lastAttemptAt,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required double lat,
                required double lon,
                Value<double?> accuracy = const Value.absent(),
                Value<double?> altitude = const Value.absent(),
                Value<double?> speed = const Value.absent(),
                Value<double?> bearing = const Value.absent(),
                Value<int?> batteryLevel = const Value.absent(),
                Value<bool?> isCharging = const Value.absent(),
                Value<String?> provider = const Value.absent(),
                Value<String?> networkType = const Value.absent(),
                Value<String?> wifiSsid = const Value.absent(),
                Value<String?> mobileOperator = const Value.absent(),
                required DateTime recordedAt,
                Value<int> uploadAttempts = const Value.absent(),
                Value<DateTime?> lastAttemptAt = const Value.absent(),
              }) => PendingLocationsCompanion.insert(
                id: id,
                lat: lat,
                lon: lon,
                accuracy: accuracy,
                altitude: altitude,
                speed: speed,
                bearing: bearing,
                batteryLevel: batteryLevel,
                isCharging: isCharging,
                provider: provider,
                networkType: networkType,
                wifiSsid: wifiSsid,
                mobileOperator: mobileOperator,
                recordedAt: recordedAt,
                uploadAttempts: uploadAttempts,
                lastAttemptAt: lastAttemptAt,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$PendingLocationsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $PendingLocationsTable,
      PendingLocation,
      $$PendingLocationsTableFilterComposer,
      $$PendingLocationsTableOrderingComposer,
      $$PendingLocationsTableAnnotationComposer,
      $$PendingLocationsTableCreateCompanionBuilder,
      $$PendingLocationsTableUpdateCompanionBuilder,
      (
        PendingLocation,
        BaseReferences<_$AppDatabase, $PendingLocationsTable, PendingLocation>,
      ),
      PendingLocation,
      PrefetchHooks Function()
    >;
typedef $$AppSettingsTableCreateCompanionBuilder =
    AppSettingsCompanion Function({
      required String key,
      required String value,
      Value<int> rowid,
    });
typedef $$AppSettingsTableUpdateCompanionBuilder =
    AppSettingsCompanion Function({
      Value<String> key,
      Value<String> value,
      Value<int> rowid,
    });

class $$AppSettingsTableFilterComposer
    extends Composer<_$AppDatabase, $AppSettingsTable> {
  $$AppSettingsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );
}

class $$AppSettingsTableOrderingComposer
    extends Composer<_$AppDatabase, $AppSettingsTable> {
  $$AppSettingsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$AppSettingsTableAnnotationComposer
    extends Composer<_$AppDatabase, $AppSettingsTable> {
  $$AppSettingsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);
}

class $$AppSettingsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $AppSettingsTable,
          AppSetting,
          $$AppSettingsTableFilterComposer,
          $$AppSettingsTableOrderingComposer,
          $$AppSettingsTableAnnotationComposer,
          $$AppSettingsTableCreateCompanionBuilder,
          $$AppSettingsTableUpdateCompanionBuilder,
          (
            AppSetting,
            BaseReferences<_$AppDatabase, $AppSettingsTable, AppSetting>,
          ),
          AppSetting,
          PrefetchHooks Function()
        > {
  $$AppSettingsTableTableManager(_$AppDatabase db, $AppSettingsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$AppSettingsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$AppSettingsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$AppSettingsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> value = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => AppSettingsCompanion(key: key, value: value, rowid: rowid),
          createCompanionCallback:
              ({
                required String key,
                required String value,
                Value<int> rowid = const Value.absent(),
              }) => AppSettingsCompanion.insert(
                key: key,
                value: value,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$AppSettingsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $AppSettingsTable,
      AppSetting,
      $$AppSettingsTableFilterComposer,
      $$AppSettingsTableOrderingComposer,
      $$AppSettingsTableAnnotationComposer,
      $$AppSettingsTableCreateCompanionBuilder,
      $$AppSettingsTableUpdateCompanionBuilder,
      (
        AppSetting,
        BaseReferences<_$AppDatabase, $AppSettingsTable, AppSetting>,
      ),
      AppSetting,
      PrefetchHooks Function()
    >;
typedef $$AuditLogsTableCreateCompanionBuilder =
    AuditLogsCompanion Function({
      Value<int> id,
      required String event,
      Value<String?> details,
      required DateTime at,
    });
typedef $$AuditLogsTableUpdateCompanionBuilder =
    AuditLogsCompanion Function({
      Value<int> id,
      Value<String> event,
      Value<String?> details,
      Value<DateTime> at,
    });

class $$AuditLogsTableFilterComposer
    extends Composer<_$AppDatabase, $AuditLogsTable> {
  $$AuditLogsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get event => $composableBuilder(
    column: $table.event,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get details => $composableBuilder(
    column: $table.details,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get at => $composableBuilder(
    column: $table.at,
    builder: (column) => ColumnFilters(column),
  );
}

class $$AuditLogsTableOrderingComposer
    extends Composer<_$AppDatabase, $AuditLogsTable> {
  $$AuditLogsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get event => $composableBuilder(
    column: $table.event,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get details => $composableBuilder(
    column: $table.details,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get at => $composableBuilder(
    column: $table.at,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$AuditLogsTableAnnotationComposer
    extends Composer<_$AppDatabase, $AuditLogsTable> {
  $$AuditLogsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get event =>
      $composableBuilder(column: $table.event, builder: (column) => column);

  GeneratedColumn<String> get details =>
      $composableBuilder(column: $table.details, builder: (column) => column);

  GeneratedColumn<DateTime> get at =>
      $composableBuilder(column: $table.at, builder: (column) => column);
}

class $$AuditLogsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $AuditLogsTable,
          AuditLog,
          $$AuditLogsTableFilterComposer,
          $$AuditLogsTableOrderingComposer,
          $$AuditLogsTableAnnotationComposer,
          $$AuditLogsTableCreateCompanionBuilder,
          $$AuditLogsTableUpdateCompanionBuilder,
          (AuditLog, BaseReferences<_$AppDatabase, $AuditLogsTable, AuditLog>),
          AuditLog,
          PrefetchHooks Function()
        > {
  $$AuditLogsTableTableManager(_$AppDatabase db, $AuditLogsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$AuditLogsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$AuditLogsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$AuditLogsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<String> event = const Value.absent(),
                Value<String?> details = const Value.absent(),
                Value<DateTime> at = const Value.absent(),
              }) => AuditLogsCompanion(
                id: id,
                event: event,
                details: details,
                at: at,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required String event,
                Value<String?> details = const Value.absent(),
                required DateTime at,
              }) => AuditLogsCompanion.insert(
                id: id,
                event: event,
                details: details,
                at: at,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$AuditLogsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $AuditLogsTable,
      AuditLog,
      $$AuditLogsTableFilterComposer,
      $$AuditLogsTableOrderingComposer,
      $$AuditLogsTableAnnotationComposer,
      $$AuditLogsTableCreateCompanionBuilder,
      $$AuditLogsTableUpdateCompanionBuilder,
      (AuditLog, BaseReferences<_$AppDatabase, $AuditLogsTable, AuditLog>),
      AuditLog,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$PendingLocationsTableTableManager get pendingLocations =>
      $$PendingLocationsTableTableManager(_db, _db.pendingLocations);
  $$AppSettingsTableTableManager get appSettings =>
      $$AppSettingsTableTableManager(_db, _db.appSettings);
  $$AuditLogsTableTableManager get auditLogs =>
      $$AuditLogsTableTableManager(_db, _db.auditLogs);
}
